process.loadEnvFile();
const { join } = require('node:path');
const mailer = require('../www/services/mailer.js');
const fetchWorkerUsage = require('./utils/fetchWorkerUsage.js');
const escapeHtml = require('./utils/escapeHtml.js');
const {
	WORKER_SCRIPT_NAME, WORKERS_FREE_CAP, WARNING_THRESHOLD, CRITICAL_THRESHOLD, DATA_DIR, STATE_PATH,
	getCredentials, listLiveRoutes, removeRoutes, addRoutes, readJson, writeJsonAtomic, readState, writeState, getPopularityRank, sortByRank,
} = require('./utils/edgeRoutes.js');

const RECOVERY_FRACTION = 0.5; // restore only the top half (most popular) of what was emergency-removed
const WATCHDOG_STATE_PATH = join(DATA_DIR, 'worker-usage-watchdog.json');
const FROM = `Sefinek Blocklists <${process.env.MAILER_AUTH_USER}>`;

const { token, zoneId } = getCredentials();

const isNewUtcDaySince = isoTimestamp => new Date(isoTimestamp).toISOString().slice(0, 10) !== new Date().toISOString().slice(0, 10);

const formatPct = usage => `${((usage / WORKERS_FREE_CAP) * 100).toFixed(1)}%`;

const sendAlertEmail = async (subject, html) => {
	await mailer.sendMail({ from: FROM, to: process.env.MAILER_AUTH_USER, subject, html });
};

const shouldSendWarning = async () => {
	const { lastWarningAt } = await readJson(WATCHDOG_STATE_PATH, {}).catch(() => ({}));
	return !lastWarningAt || isNewUtcDaySince(lastWarningAt);
};

const markWarningSent = () => writeJsonAtomic(WATCHDOG_STATE_PATH, { lastWarningAt: new Date().toISOString() });

const emergencyRemoveRoutes = async state => {
	// Based on the routes actually live on Cloudflare, not the local state (can drift)
	const live = await listLiveRoutes();
	const { removed, failed } = await removeRoutes(live);

	// Paths still pending from an earlier, partially recovered emergency are merged in so they aren't forgotten
	const previousRank = getPopularityRank(state);
	const pending = new Set([...removed, ...(state.emergencyRemovedPaths ?? [])].filter(p => !failed.has(p)));
	const rank = sortByRank([...new Set([...previousRank, ...failed, ...pending])], previousRank);
	const now = new Date().toISOString();

	await writeState({
		paths: sortByRank([...failed], rank),
		updatedAt: now,
		emergencyStoppedAt: now,
		emergencyRemovedPaths: sortByRank([...pending], rank),
		popularityRank: rank,
	});

	return { removedCount: removed.size, failedCount: failed.size, totalCount: live.length };
};

// Gated on emergencyRemovedPaths, not state.paths.length, so a partial recovery can resume next day
const attemptRecovery = async (state, usage) => {
	if (!state.emergencyRemovedPaths?.length) return false;
	if (!isNewUtcDaySince(state.lastRecoveryAt || state.emergencyStoppedAt)) return false;

	// A new UTC day only means the daily cap *may* have reset - the usage figure itself is a trailing
	// 24h window, so it can still be elevated from before the emergency removal. Restoring routes on
	// date alone (no usage check) caused back-to-back CRITICAL hits (2026-09-12/13). Wait for usage to
	// actually clear the warning zone; the 3h cron retries this check every run until it does.
	if (usage >= WARNING_THRESHOLD) {
		console.log(`Recovery postponed: usage still at ${formatPct(usage)} (>= ${formatPct(WARNING_THRESHOLD)} safety threshold), retrying next run`);
		return false;
	}

	const active = new Set(state.paths);
	const pending = state.emergencyRemovedPaths.filter(p => !active.has(p));
	const cutoff = Math.max(1, Math.ceil(pending.length * RECOVERY_FRACTION));
	const toRestore = pending.slice(0, cutoff);
	const restored = toRestore.length ? await addRoutes(toRestore) : [];

	const restoredSet = new Set(restored);
	const remaining = pending.filter(p => !restoredSet.has(p));
	const rank = getPopularityRank(state);
	await writeState({
		paths: sortByRank([...state.paths, ...restored], rank),
		updatedAt: new Date().toISOString(),
		...(remaining.length ? { emergencyStoppedAt: state.emergencyStoppedAt, lastRecoveryAt: new Date().toISOString(), emergencyRemovedPaths: remaining, popularityRank: rank } : {}),
	});

	if (!toRestore.length) return true;

	await sendAlertEmail(
		`[PRZYWRACANIE] Trasy Workera: ${restored.length}/${toRestore.length}`,
		`<p>Rozpoczął się nowy dzień UTC, a zużycie spadło poniżej ${formatPct(WARNING_THRESHOLD)} limitu. Przywrócono ${restored.length}/${toRestore.length} tras z wybranej partii (${(RECOVERY_FRACTION * 100).toFixed(0)}% najpopularniejszych spośród oczekujących).</p>
<p>${remaining.length ? `Pozostałe trasy: ${remaining.length}. Kolejna próba najwcześniej w następnym dniu UTC, gdy zużycie będzie poniżej progu ostrzegawczego.` : 'Przywrócono wszystkie oczekujące trasy.'} Kontrola zużycia odbywa się co 3 godziny.</p>`
	);

	return true;
};

(async () => {
	let state = await readState();

	if (!state.paths.length && !state.emergencyRemovedPaths?.length) {
		console.log('No routes currently selected, nothing to watch');
		process.exit(0);
	}

	const usage = await fetchWorkerUsage({ token, zoneId });

	if (await attemptRecovery(state, usage)) state = await readState();

	if (!state.paths.length) {
		console.log('No routes currently active, nothing to watch');
		process.exit(0);
	}

	const pct = formatPct(usage);
	console.log(`Worker invocations (last 24h): ${usage.toLocaleString()} / ${WORKERS_FREE_CAP.toLocaleString()} (${pct})`);

	if (usage >= CRITICAL_THRESHOLD) {
		console.error('CRITICAL threshold exceeded, removing Worker routes immediately');
		const { removedCount, failedCount, totalCount } = await emergencyRemoveRoutes(state);
		const partialWarning = failedCount
			? `<p><b>Nieudane usunięcia:</b> ${failedCount}/${totalCount}. Te trasy nadal działają. Szczegóły w logach crona. Ponowna próba za maks. 3 godziny, jeśli zużycie nadal będzie krytyczne. W pilnej sytuacji usuń je ręcznie.</p>`
			: '';
		await sendAlertEmail(
			`[ALARM] Usunięto ${removedCount}/${totalCount} tras Workera (${pct} limitu)`,
			`<p><b>Awaryjnie usunięto ${removedCount}/${totalCount} tras Workera <code>${WORKER_SCRIPT_NAME}</code>.</b> Wywołania z ostatnich 24 godzin: ${usage.toLocaleString('pl-PL')} / ${WORKERS_FREE_CAP.toLocaleString('pl-PL')} (${pct} limitu dziennego).</p>
${partialWarning}
<p>Ruch dla usuniętych tras trafia bezpośrednio do serwera źródłowego, bez cache Workera.</p>
<p>Przywracanie: ${(RECOVERY_FRACTION * 100).toFixed(0)}% najpopularniejszych oczekujących tras na dzień UTC, najwcześniej od kolejnego dnia i po spadku zużycia poniżej ${formatPct(WARNING_THRESHOLD)}.</p>
<p>Plik stanu: <code>${escapeHtml(STATE_PATH)}</code>.</p>`
		);
		process.exit(0);
	}

	if (usage >= WARNING_THRESHOLD) {
		console.warn('WARNING threshold exceeded');
		if (!await shouldSendWarning()) {
			console.log('Warning email already sent today (UTC), skipping');
			process.exit(0);
		}

		await sendAlertEmail(
			`[OSTRZEŻENIE] Worker: ${pct} limitu dziennego`,
			`<p>Wywołania Workera <code>${WORKER_SCRIPT_NAME}</code> z ostatnich 24 godzin: ${usage.toLocaleString('pl-PL')} / ${WORKERS_FREE_CAP.toLocaleString('pl-PL')} (${pct} limitu dziennego).</p>
<p>Trasy pozostają aktywne. Automatyczne usuwanie uruchomi się przy ${formatPct(CRITICAL_THRESHOLD)}. Sprawdź przyczynę wzrostu ruchu.</p>
<p>Kolejne ostrzeżenie najwcześniej w następnym dniu UTC. Alerty krytyczne są wysyłane bez tego ograniczenia.</p>`
		);
		await markWarningSent();
	}

	process.exit(0);
})().catch(async err => {
	console.error('worker-usage-watchdog failed:', err.message);
	try {
		await sendAlertEmail('[BŁĄD] Monitor zużycia Workera', `<p>Monitor zużycia Workera nie zakończył działania:</p><pre>${escapeHtml(err.message)}</pre><p>Sprawdź trasy w Cloudflare. Mogą różnić się od pliku stanu <code>${escapeHtml(STATE_PATH)}</code>.</p>`);
	} catch (mailErr) {
		console.error('Also failed to send the crash alert email:', mailErr.message);
	}
	process.exit(1);
});
