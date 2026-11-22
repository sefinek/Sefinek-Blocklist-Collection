process.loadEnvFile();
const RedisClient = require('../www/services/redis.js');
const mailer = require('../www/services/mailer.js');
const fetchWorkerUsage = require('./utils/fetchWorkerUsage.js');
const escapeHtml = require('./utils/escapeHtml.js');
const { REDIRECT_PATHS } = require('../www/routes/Blocklists/Deprecated.js');
const {
	WORKERS_FREE_CAP, WARNING_THRESHOLD, STATE_PATH,
	getCredentials, listLiveRoutes, removeRoutes, addRoutes, readState, writeState, sortByRank,
} = require('./utils/edgeRoutes.js');

const ROLLING_DAYS = 7;
const ENTRY_AVG_THRESHOLD = 100; // req/day avg required for a new path to be added
const EXIT_AVG_THRESHOLD = 60; // req/day avg below which an already-included path is dropped
const BUDGET_DAILY = 60000; // target avg req/day across selected paths (Workers Free cap is 100k/day)
const MAX_ROUTES = 100; // hard ceiling regardless of budget math

const FROM = `Sefinek Blocklists <${process.env.MAILER_AUTH_USER}>`;

const { token, zoneId } = getCredentials();

const getFilepopKeys = () => {
	const keys = [];
	for (let i = 0; i < ROLLING_DAYS; i++) {
		const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
		keys.push(`stats:filepop:${d.toISOString().slice(0, 10)}`);
	}
	return keys;
};

const selectPaths = (avgByPath, previousPaths) => {
	const retained = previousPaths
		.map(path => ({ path, avg: avgByPath.get(path) || 0 }))
		.filter(r => r.avg >= EXIT_AVG_THRESHOLD)
		.sort((a, b) => b.avg - a.avg);
	const retainedSet = new Set(retained.map(r => r.path));

	const candidates = [...avgByPath.entries()]
		.filter(([path, avg]) => !retainedSet.has(path) && avg >= ENTRY_AVG_THRESHOLD)
		.map(([path, avg]) => ({ path, avg }))
		.sort((a, b) => b.avg - a.avg);

	const selected = [];
	const overflowDropped = [];
	let budgetUsed = 0;

	for (const r of retained) {
		if (selected.length < MAX_ROUTES && budgetUsed + r.avg <= BUDGET_DAILY) {
			selected.push(r);
			budgetUsed += r.avg;
		} else {
			overflowDropped.push(r);
		}
	}

	const added = [];
	for (const c of candidates) {
		if (selected.length >= MAX_ROUTES || budgetUsed + c.avg > BUDGET_DAILY) continue;
		selected.push(c);
		budgetUsed += c.avg;
		added.push(c);
	}

	const removed = previousPaths.filter(p => !retainedSet.has(p)).map(p => ({ path: p, avg: avgByPath.get(p) || 0 }));

	selected.sort((a, b) => b.avg - a.avg);
	return { selected, added, removed, overflowDropped, budgetUsed };
};

const fetchActualUsage = async () => {
	try {
		return await fetchWorkerUsage({ token, zoneId });
	} catch (err) {
		console.error('Analytics usage check failed:', err.message);
		return null;
	}
};

const renderList = rows => rows.length
	? `<ul>${rows.map(r => `<li>${escapeHtml(r.path)} (~${Math.round(r.avg)}/dzień)</li>`).join('')}</ul>`
	: '<p><i>brak</i></p>';

const renderSection = (title, rows) => rows.length ? `<h3>${title} (${rows.length})</h3>\n${renderList(rows)}` : '';

const sendSummaryEmail = async ({ addedRows, notAddedRows, deferReason, removedRows, removeFailedRows, overflowDropped, budgetUsed, actualUsage, pendingCount }) => {
	const usageLine = actualUsage === null
		? '<p><i>Nie udało się pobrać zużycia Workera (błąd API).</i></p>'
		: `<p><b>Wywołania Workera z ostatnich 24 godzin:</b> ${actualUsage.toLocaleString('pl-PL')} / ${WORKERS_FREE_CAP.toLocaleString('pl-PL')} (${((actualUsage / WORKERS_FREE_CAP) * 100).toFixed(1)}% limitu dziennego)</p>`;

	await mailer.sendMail({
		from: FROM,
		to: process.env.MAILER_AUTH_USER,
		subject: `Aktualizacja tras Workera (+${addedRows.length}/-${removedRows.length}${notAddedRows.length ? `, niedodane: ${notAddedRows.length}` : ''}${removeFailedRows.length ? `, nieusunięte: ${removeFailedRows.length}` : ''})`,
		html: `<p>Zakończono synchronizację tras cache Workera dla <a href="https://blocklist.sefinek.net">blocklist.sefinek.net</a>.</p>
<p><b>Szacowany ruch wybranych tras:</b> ~${Math.round(budgetUsed).toLocaleString('pl-PL')} / ${BUDGET_DAILY.toLocaleString('pl-PL')} żądań dziennie (przyjęty budżet)</p>
${usageLine}
${pendingCount ? `<p><b>Trwa wstrzymanie awaryjne.</b> Trasy oczekujące na stopniowe przywrócenie: ${pendingCount}.</p>` : ''}
${renderSection('Dodane', addedRows)}
${renderSection(`Niedodane - ${deferReason ?? 'błąd API, sprawdź logi crona'}`, notAddedRows)}
${renderSection('Usunięte z aktualnego wyboru', removedRows)}
${renderSection('Nieusunięte - nadal aktywne, sprawdź logi crona', removeFailedRows)}
${renderSection('Poza wyborem z powodu budżetu ruchu', overflowDropped)}
<p>Plik stanu: <code>${escapeHtml(STATE_PATH)}</code></p>`,
	});
};

(async () => {
	const keys = getFilepopKeys();
	const [unionRows, existingDays] = await Promise.all([
		RedisClient.zUnionWithScores(keys),
		RedisClient.exists(keys),
	]);
	const observedDays = Math.max(1, existingDays);
	if (existingDays < ROLLING_DAYS) console.log(`Only ${existingDays}/${ROLLING_DAYS} days of history so far - averaging over ${observedDays} instead`);

	const avgByPath = new Map();
	for (const { value, score } of unionRows) {
		if (REDIRECT_PATHS.has(value)) continue; // redirects always 301, never cacheable
		avgByPath.set(value, score / observedDays);
	}
	const toRows = paths => paths.map(path => ({ path, avg: avgByPath.get(path) || 0 }));

	// Paths pending after an emergency stop are still part of the intended selection (hysteresis applies to them too)
	const state = await readState();
	const previousTarget = [...new Set([...state.paths, ...(state.emergencyRemovedPaths ?? [])])];
	const { selected, added, removed, overflowDropped, budgetUsed } = selectPaths(avgByPath, previousTarget);
	const target = selected.map(r => r.path);
	const targetSet = new Set(target);

	console.log(`Selected ${target.length} paths, ~${Math.round(budgetUsed)} req/day estimated (target ${BUDGET_DAILY}/day)`);
	console.log(`Selection change - added: ${added.length}, removed: ${removed.length}, overflow-dropped: ${overflowDropped.length}`);

	// Diffed against what's actually live on Cloudflare, not the state file, so any drift gets corrected too
	const live = await listLiveRoutes();
	const liveSet = new Set(live.map(r => r.path));
	const toRemove = live.filter(r => !targetSet.has(r.path));
	const toAdd = target.filter(p => !liveSet.has(p));
	const inEmergency = Boolean(state.emergencyRemovedPaths?.length);
	const selectionChanged = added.length || removed.length || overflowDropped.length;

	if (!selectionChanged && !toRemove.length && (inEmergency || !toAdd.length)) {
		console.log('No change, skipping');
		process.exit(0);
	}

	const actualUsage = await fetchActualUsage();

	// Removing is always safe; adding is left to the watchdog's gradual recovery during an emergency stop,
	// and postponed when usage is already in the warning zone (the watchdog would likely remove them again)
	let deferReason = null;
	if (inEmergency) deferReason = 'wstrzymanie awaryjne, przywracaniem zajmuje się monitor zużycia';
	else if (actualUsage !== null && actualUsage >= WARNING_THRESHOLD) deferReason = 'przekroczony próg ostrzegawczy, kolejna próba za tydzień';

	const { removed: removedLive, failed: removeFailed } = await removeRoutes(toRemove);
	const addedLive = toAdd.length && !deferReason ? await addRoutes(toAdd) : [];

	const nowLive = [...liveSet].filter(p => !removedLive.has(p)).concat(addedLive);
	const rank = [...target, ...removeFailed];
	const nowLiveSet = new Set(nowLive);
	const pending = inEmergency ? target.filter(p => !nowLiveSet.has(p)) : [];

	await writeState({
		paths: sortByRank(nowLive, rank),
		updatedAt: new Date().toISOString(),
		...(pending.length ? {
			emergencyStoppedAt: state.emergencyStoppedAt,
			lastRecoveryAt: state.lastRecoveryAt,
			emergencyRemovedPaths: pending,
			popularityRank: rank,
		} : {}),
	});

	const addedSet = new Set(addedLive);
	await sendSummaryEmail({
		addedRows: toRows(addedLive),
		notAddedRows: inEmergency ? [] : toRows(toAdd.filter(p => !addedSet.has(p))),
		deferReason,
		removedRows: toRows([...removedLive]),
		removeFailedRows: toRows([...removeFailed]),
		overflowDropped,
		budgetUsed,
		actualUsage,
		pendingCount: pending.length,
	});

	console.log(`Done. Cloudflare routes: +${addedLive.length}/-${removedLive.size} (${removeFailed.size} failed to remove, ${pending.length} pending), summary emailed`);
	process.exit(0);
})().catch(async err => {
	console.error('refresh-worker-routes failed:', err);
	try {
		await mailer.sendMail({
			from: FROM,
			to: process.env.MAILER_AUTH_USER,
			subject: '[BŁĄD] Aktualizacja tras Workera',
			html: `<p>Aktualizacja tras Workera nie zakończyła się poprawnie:</p><pre>${escapeHtml(err.message)}</pre><p>Część zmian mogła zostać zastosowana. Kolejne uruchomienie zsynchronizuje trasy z Cloudflare. Możesz też uruchomić ręcznie <code>node scripts/refresh-worker-routes.js</code>.</p><p>Plik stanu: <code>${escapeHtml(STATE_PATH)}</code>.</p>`,
		});
	} catch (mailErr) {
		console.error('Also failed to send the crash alert email:', mailErr.message);
	}
	process.exit(1);
});
