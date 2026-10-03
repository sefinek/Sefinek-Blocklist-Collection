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
		`[RECOVERY] Restored ${restored.length}/${toRestore.length} Worker routes after daily cap reset`,
		`<p>The Workers Free daily cap reset since the last emergency stop (${state.emergencyStoppedAt}), so the watchdog restored the top ${(RECOVERY_FRACTION * 100).toFixed(0)}% most popular routes from what was removed (${restored.length}/${toRestore.length} succeeded${remaining.length ? `, ${remaining.length} still pending and will resume tomorrow` : ''}).</p>
<p>This is a conservative restore, not the full previous list, to reduce the chance of immediately hitting the cap again. Normal usage monitoring resumes from here - the next check runs in up to 3h.</p>`
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
			? `<p><b>Warning:</b> ${failedCount} of ${totalCount} route(s) failed to remove (see cron logs) - they're still live and kept in <code>paths</code>, so the next run (up to 3h) will retry if usage is still critical. Remove them manually if it's urgent.</p>`
			: '';
		await sendAlertEmail(
			`[CRITICAL] Worker routes removed automatically (${pct} of daily cap)`,
			`<p><b>Emergency action taken:</b> ${removedCount}/${totalCount} Worker route(s) for <code>${WORKER_SCRIPT_NAME}</code> were removed automatically because usage reached ${usage.toLocaleString()} / ${WORKERS_FREE_CAP.toLocaleString()} (${pct}) in the last 24h.</p>
${partialWarning}
<p>Traffic now goes straight to origin for those paths (uncached, but fully working) instead of risking Cloudflare rejecting requests once the daily Workers Free cap is hit.</p>
<p>Routes will be restored gradually (top ${(RECOVERY_FRACTION * 100).toFixed(0)}% per UTC day) once usage drops below ${formatPct(WARNING_THRESHOLD)}. State: <code>${escapeHtml(STATE_PATH)}</code>.</p>`
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
			`[WARNING] Worker route usage at ${pct} of daily cap`,
			`<p>Worker route usage for <code>${WORKER_SCRIPT_NAME}</code> reached ${usage.toLocaleString()} / ${WORKERS_FREE_CAP.toLocaleString()} (${pct}) in the last 24h.</p>
<p>No action taken yet - automatic emergency removal triggers at ${formatPct(CRITICAL_THRESHOLD)}. Consider running <code>scripts/refresh-worker-routes.js</code> to shrink the route list, or investigate the traffic spike.</p>
<p>Further warnings are suppressed until the next UTC day (CRITICAL alerts are always sent).</p>`
		);
		await markWarningSent();
	}

	process.exit(0);
})().catch(async err => {
	console.error('worker-usage-watchdog failed:', err.message);
	try {
		await sendAlertEmail('[ERROR] worker-usage-watchdog crashed', `<p>The Workers usage watchdog failed before it could finish checking or acting on usage:</p><pre>${escapeHtml(err.message)}</pre><p>Live routes may differ from <code>${escapeHtml(STATE_PATH)}</code> - check manually.</p>`);
	} catch (mailErr) {
		console.error('Also failed to send the crash alert email:', mailErr.message);
	}
	process.exit(1);
});
