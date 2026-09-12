process.loadEnvFile();
const { readFile, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const axios = require('../www/services/axios.js');
const mailer = require('../www/services/mailer.js');
const fetchPathUsage = require('./utils/fetchPathUsage.js');
const writeWranglerToml = require('./utils/writeWranglerToml.js');

const WORKERS_FREE_CAP = 100000;
const WARNING_THRESHOLD = 0.8 * WORKERS_FREE_CAP;
const CRITICAL_THRESHOLD = 0.95 * WORKERS_FREE_CAP;

const HOST = 'blocklist.sefinek.net';
const WORKER_SCRIPT_NAME = 'sefinek-blocklist-edge-cache';
const ROUTES_JSON_PATH = join(__dirname, '..', 'cloudflare', 'routes.json');
const FROM = `Sefinek Blocklists <${process.env.MAILER_AUTH_USER}>`;

const { CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID } = process.env;
if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ZONE_ID) throw new Error('Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ZONE_ID environment variable');

const readSelectedPaths = async () => {
	try {
		return JSON.parse(await readFile(ROUTES_JSON_PATH, 'utf-8')).paths || [];
	} catch {
		return [];
	}
};

const emergencyRemoveRoutes = async () => {
	const headers = { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` };
	const list = await axios.get(`https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/workers/routes`, { headers });
	const ours = (list.data.result || []).filter(r => r.script === WORKER_SCRIPT_NAME);

	const results = await Promise.allSettled(
		ours.map(route => axios.delete(`https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/workers/routes/${route.id}`, { headers }))
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

	// Reflect only what was actually removed - never claim a clean sweep that didn't happen
	await writeFile(ROUTES_JSON_PATH, JSON.stringify({ paths: stillActivePaths, updatedAt: new Date().toISOString(), emergencyStoppedAt: new Date().toISOString() }, null, '\t') + '\n');
	await writeWranglerToml(stillActivePaths);

	return { removedCount, failedCount: stillActivePaths.length, totalCount: ours.length };
};

const sendAlertEmail = async (subject, html) => {
	await mailer.sendMail({ from: FROM, to: process.env.MAILER_AUTH_USER, subject, html });
};

(async () => {
	const paths = await readSelectedPaths();
	if (!paths.length) {
		console.log('No routes currently selected, nothing to watch.');
		process.exit(0);
	}

	const usage = await fetchPathUsage(paths, { token: CLOUDFLARE_API_TOKEN, zoneId: CLOUDFLARE_ZONE_ID });
	const pct = (usage / WORKERS_FREE_CAP) * 100;
	console.log(`Worker route usage (last 24h): ${usage.toLocaleString()} / ${WORKERS_FREE_CAP.toLocaleString()} (${pct.toFixed(1)}%)`);

	if (usage >= CRITICAL_THRESHOLD) {
		console.error('CRITICAL threshold exceeded, removing Worker routes immediately.');
		const { removedCount, failedCount, totalCount } = await emergencyRemoveRoutes();
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
		console.warn('WARNING threshold exceeded.');
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
