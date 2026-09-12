process.loadEnvFile();
const { readFile, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const axios = require('../www/services/axios.js');
const mailer = require('../www/services/mailer.js');
const fetchWorkerUsage = require('./utils/fetchWorkerUsage.js');
const writeWranglerToml = require('./utils/writeWranglerToml.js');
const withRetry = require('./utils/withRetry.js');

const WORKERS_FREE_CAP = 100000;
const WARNING_THRESHOLD = 0.8 * WORKERS_FREE_CAP;
const CRITICAL_THRESHOLD = 0.95 * WORKERS_FREE_CAP;
const RECOVERY_FRACTION = 0.5; // restore only the top half (most popular) of what was emergency-removed

const HOST = 'blocklist.sefinek.net';
const WORKER_SCRIPT_NAME = 'sefinek-blocklist-edge-cache';
const ROUTES_JSON_PATH = join(__dirname, '..', 'cloudflare', 'routes.json');
const FROM = `Sefinek Blocklists <${process.env.MAILER_AUTH_USER}>`;

const { CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID } = process.env;
if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ZONE_ID) throw new Error('Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ZONE_ID environment variable');

// Firing 150+ route mutations at once against the Workers Routes API reliably draws a handful
// of transient 503s - retry with backoff instead of treating those as permanent failures.
const isRetryableRouteError = err => [429, 503].includes(err.response?.status);
const retryRouteRequest = fn => withRetry(fn, { isRetryable: isRetryableRouteError });

const readState = async () => {
	try {
		return JSON.parse(await readFile(ROUTES_JSON_PATH, 'utf-8'));
	} catch {
		return { paths: [] };
	}
};

const emergencyRemoveRoutes = async popularityRankedPaths => {
	const headers = { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` };
	const list = await axios.get(`https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/workers/routes`, { headers });
	const ours = (list.data.result || []).filter(r => r.script === WORKER_SCRIPT_NAME);

	const results = await Promise.allSettled(
		ours.map(route => retryRouteRequest(() => axios.delete(`https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/workers/routes/${route.id}`, { headers })))
	);

	const stillActivePaths = [];
	let removedCount = 0;
	results.forEach((result, i) => {
		if (result.status === 'fulfilled') {
			removedCount++;
			return;
		}
		console.error(`Failed to remove route ${ours[i].pattern}:`, result.reason?.message);
		stillActivePaths.push(ours[i].pattern.replace(HOST, ''));
	});

	// Base this on the routes that were actually live on Cloudflare (not the caller's local
	// path list, which can drift from it - e.g. routes.json updated but never `wrangler deploy`ed)
	// so nothing removed here is ever lost from recovery bookkeeping. Popularity only decides order.
	const popularityIndex = new Map(popularityRankedPaths.map((p, i) => [p, i]));
	const emergencyRemovedPaths = ours
		.map(r => r.pattern.replace(HOST, ''))
		.filter(p => !stillActivePaths.includes(p))
		.sort((a, b) => (popularityIndex.get(a) ?? Infinity) - (popularityIndex.get(b) ?? Infinity));

	// Reflect only what was actually removed - never claim a clean sweep that didn't happen
	await writeFile(ROUTES_JSON_PATH, JSON.stringify({
		paths: stillActivePaths,
		updatedAt: new Date().toISOString(),
		emergencyStoppedAt: new Date().toISOString(),
		emergencyRemovedPaths,
	}, null, '\t') + '\n');
	await writeWranglerToml(stillActivePaths);

	return { removedCount, failedCount: stillActivePaths.length, totalCount: ours.length };
};

const addRoutes = async paths => {
	const headers = { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` };
	const results = await Promise.allSettled(
		paths.map(path => retryRouteRequest(() => axios.post(`https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/workers/routes`, {
			pattern: `${HOST}${path}`,
			script: WORKER_SCRIPT_NAME,
		}, { headers })))
	);

	const restored = [];
	results.forEach((result, i) => {
		if (result.status === 'fulfilled') restored.push(paths[i]);
		else console.error(`Failed to restore route for ${paths[i]}:`, result.reason?.message);
	});
	return restored;
};

const isNewUtcDaySince = isoTimestamp => new Date(isoTimestamp).toISOString().slice(0, 10) !== new Date().toISOString().slice(0, 10);

const sendAlertEmail = async (subject, html) => {
	await mailer.sendMail({ from: FROM, to: process.env.MAILER_AUTH_USER, subject, html });
};

// Runs once per UTC day, regardless of how many routes are currently active - a previous
// partial recovery (some routes restored, some still pending) must not permanently block
// this from resuming, so it's gated on emergencyRemovedPaths alone, not state.paths.length.
const attemptRecovery = async state => {
	if (!state.emergencyRemovedPaths?.length) return false;
	if (!isNewUtcDaySince(state.lastRecoveryAt || state.emergencyStoppedAt)) return false;

	const cutoff = Math.max(1, Math.ceil(state.emergencyRemovedPaths.length * RECOVERY_FRACTION));
	const toRestore = state.emergencyRemovedPaths.slice(0, cutoff);
	const restored = await addRoutes(toRestore);

	const remaining = state.emergencyRemovedPaths.filter(p => !restored.includes(p));
	const activePaths = [...state.paths, ...restored];
	await writeFile(ROUTES_JSON_PATH, JSON.stringify({
		paths: activePaths,
		updatedAt: new Date().toISOString(),
		...(remaining.length ? { emergencyStoppedAt: state.emergencyStoppedAt, lastRecoveryAt: new Date().toISOString(), emergencyRemovedPaths: remaining } : {}),
	}, null, '\t') + '\n');
	await writeWranglerToml(activePaths);

	await sendAlertEmail(
		`[RECOVERY] Restored ${restored.length}/${toRestore.length} Worker routes after daily cap reset`,
		`<p>The Workers Free daily cap reset since the last emergency stop (${state.emergencyStoppedAt}), so the watchdog restored the top ${(RECOVERY_FRACTION * 100).toFixed(0)}% most popular routes from what was removed (${restored.length}/${toRestore.length} succeeded${remaining.length ? `, ${remaining.length} still pending and will resume tomorrow` : ''}).</p>
<p>This is a conservative restore, not the full previous list, to reduce the chance of immediately hitting the cap again. Normal usage monitoring resumes from here - the next check runs in up to 3h.</p>`
	);

	return true;
};

(async () => {
	let state = await readState();

	if (await attemptRecovery(state)) state = await readState();

	if (!state.paths.length) {
		console.log('No routes currently selected, nothing to watch');
		process.exit(0);
	}

	const paths = state.paths;
	const usage = await fetchWorkerUsage({ token: CLOUDFLARE_API_TOKEN, zoneId: CLOUDFLARE_ZONE_ID });
	const pct = (usage / WORKERS_FREE_CAP) * 100;
	console.log(`Worker invocations (last 24h): ${usage.toLocaleString()} / ${WORKERS_FREE_CAP.toLocaleString()} (${pct.toFixed(1)}%)`);

	if (usage >= CRITICAL_THRESHOLD) {
		console.error('CRITICAL threshold exceeded, removing Worker routes immediately');
		const { removedCount, failedCount, totalCount } = await emergencyRemoveRoutes(paths);
		const partialWarning = failedCount
			? `<p><b>Warning:</b> ${failedCount} of ${totalCount} route(s) failed to remove (see cron logs) - they're still live and still counted in <code>cloudflare/routes.json</code>/<code>wrangler.toml</code>. Investigate and re-run the watchdog or remove them manually.</p>`
			: '';
		await sendAlertEmail(
			`[CRITICAL] Worker routes removed automatically (${pct.toFixed(1)}% of daily cap)`,
			`<p><b>Emergency action taken:</b> ${removedCount}/${totalCount} Worker route(s) for <code>${WORKER_SCRIPT_NAME}</code> were removed automatically because usage reached ${usage.toLocaleString()} / ${WORKERS_FREE_CAP.toLocaleString()} (${pct.toFixed(1)}%) in the last 24h.</p>
${partialWarning}
<p>Traffic now goes straight to origin for all paths (uncached, but fully working) instead of risking Cloudflare rejecting requests once the daily Workers Free cap is hit.</p>
<p><code>cloudflare/routes.json</code> has been updated. Next run of <code>scripts/refresh-worker-routes.js</code> will rebuild the candidate list from scratch - review it before <code>wrangler deploy</code>.</p>`
		);
		process.exit(0);
	}

	if (usage >= WARNING_THRESHOLD) {
		console.warn('WARNING threshold exceeded');
		await sendAlertEmail(
			`[WARNING] Worker route usage at ${pct.toFixed(1)}% of daily cap`,
			`<p>Worker route usage for <code>${WORKER_SCRIPT_NAME}</code> reached ${usage.toLocaleString()} / ${WORKERS_FREE_CAP.toLocaleString()} (${pct.toFixed(1)}%) in the last 24h.</p>
<p>No action taken yet - automatic emergency removal triggers at ${(CRITICAL_THRESHOLD / WORKERS_FREE_CAP * 100).toFixed(0)}%. Consider running <code>scripts/refresh-worker-routes.js</code> to shrink the route list, or investigate the traffic spike.</p>`
		);
	}

	process.exit(0);
})().catch(async err => {
	console.error('worker-usage-watchdog failed:', err.message);
	try {
		await sendAlertEmail('[ERROR] worker-usage-watchdog crashed', `<p>The Workers usage watchdog failed before it could finish checking or acting on usage:</p><pre>${err.message}</pre><p>Nothing in <code>cloudflare/routes.json</code> was necessarily updated - check manually.</p>`);
	} catch (mailErr) {
		console.error('Also failed to send the crash alert email:', mailErr.message);
	}
	process.exit(1);
});
