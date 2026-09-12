process.loadEnvFile();
const { readFile, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const RedisClient = require('../www/services/redis.js');
const mailer = require('../www/services/mailer.js');
const fetchPathUsage = require('./utils/fetchPathUsage.js');
const writeWranglerToml = require('./utils/writeWranglerToml.js');

const ROLLING_DAYS = 7;
const ENTRY_AVG_THRESHOLD = 100; // req/day avg required for a new path to be added
const EXIT_AVG_THRESHOLD = 60; // req/day avg below which an already-included path is dropped
const BUDGET_DAILY = 60000; // target avg req/day across selected paths (Workers Free cap is 100k/day)
const WORKERS_FREE_CAP = 100000;

const ROUTES_JSON_PATH = join(__dirname, '..', 'cloudflare', 'routes.json');
const FROM = `Sefinek Blocklists <${process.env.MAILER_AUTH_USER}>`;

const { CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID } = process.env;

const getFilepopKeys = () => {
	const keys = [];
	for (let i = 0; i < ROLLING_DAYS; i++) {
		const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
		keys.push(`stats:filepop:${d.toISOString().slice(0, 10)}`);
	}
	return keys;
};

const readRoutesJson = async () => {
	try {
		return JSON.parse(await readFile(ROUTES_JSON_PATH, 'utf-8')).paths || [];
	} catch {
		return [];
	}
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
		if (budgetUsed + r.avg <= BUDGET_DAILY) {
			selected.push(r);
			budgetUsed += r.avg;
		} else {
			overflowDropped.push(r);
		}
	}

	const added = [];
	for (const c of candidates) {
		if (budgetUsed + c.avg > BUDGET_DAILY) continue;
		selected.push(c);
		budgetUsed += c.avg;
		added.push(c);
	}

	const removed = previousPaths.filter(p => !retainedSet.has(p)).map(p => ({ path: p, avg: avgByPath.get(p) || 0 }));

	selected.sort((a, b) => b.avg - a.avg);
	return { selected, added, removed, overflowDropped, budgetUsed };
};

const fetchActualUsage = async paths => {
	if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ZONE_ID || !paths.length) return null;

	try {
		return await fetchPathUsage(paths, { token: CLOUDFLARE_API_TOKEN, zoneId: CLOUDFLARE_ZONE_ID });
	} catch (err) {
		console.error('Analytics usage check failed:', err.message);
		return null;
	}
};

const renderList = rows => rows.length
	? `<ul>${rows.map(r => `<li>${r.path} (~${Math.round(r.avg)}/day)</li>`).join('')}</ul>`
	: '<p><i>none</i></p>';

const sendSummaryEmail = async ({ added, removed, overflowDropped, budgetUsed, actualUsage }) => {
	const usageLine = actualUsage === null
		? '<p><i>Actual Workers usage check unavailable (missing token or API error).</i></p>'
		: `<p><b>Actual requests to selected paths (last 24h):</b> ${actualUsage.toLocaleString()} / ${WORKERS_FREE_CAP.toLocaleString()} Workers Free daily cap (${((actualUsage / WORKERS_FREE_CAP) * 100).toFixed(1)}%)</p>`;

	await mailer.sendMail({
		from: FROM,
		to: process.env.MAILER_AUTH_USER,
		subject: `Worker route list updated (+${added.length}/-${removed.length}${overflowDropped.length ? `, ${overflowDropped.length} dropped over budget` : ''})`,
		html: `<p>The edge-cache candidate list for <a href="https://blocklist.sefinek.net">blocklist.sefinek.net</a> Worker (${join('cloudflare', 'routes.json')}) has changed.</p>
<p><b>Estimated budget used:</b> ~${Math.round(budgetUsed).toLocaleString()} / ${BUDGET_DAILY.toLocaleString()} req/day target</p>
${usageLine}
<h3>Added (${added.length})</h3>
${renderList(added)}
<h3>Removed - popularity dropped below threshold (${removed.length})</h3>
${renderList(removed)}
${overflowDropped.length ? `<h3>Dropped due to budget overflow, not popularity (${overflowDropped.length})</h3>${renderList(overflowDropped)}` : ''}
<p><b>cloudflare/wrangler.toml has been regenerated.</b> Review it and run <code>wrangler deploy</code> from the <code>cloudflare/</code> directory to apply.</p>`,
	});
};

(async () => {
	const keys = getFilepopKeys();
	const [unionRows, existingDays] = await Promise.all([
		RedisClient.zUnionWithScores(keys),
		RedisClient.exists(keys),
	]);
	const observedDays = Math.max(1, existingDays);
	if (existingDays < ROLLING_DAYS) console.log(`Only ${existingDays}/${ROLLING_DAYS} days of history so far - averaging over ${observedDays} instead.`);

	const avgByPath = new Map();
	for (const { value, score } of unionRows) avgByPath.set(value, score / observedDays);

	const previousPaths = await readRoutesJson();
	const { selected, added, removed, overflowDropped, budgetUsed } = selectPaths(avgByPath, previousPaths);
	const selectedPaths = selected.map(r => r.path);

	console.log(`Selected ${selectedPaths.length} paths, ~${Math.round(budgetUsed)} req/day estimated (target ${BUDGET_DAILY}/day)`);
	console.log(`Added: ${added.length}, removed: ${removed.length}, overflow-dropped: ${overflowDropped.length}`);

	if (!added.length && !removed.length && !overflowDropped.length) {
		console.log('No change, skipping.');
		process.exit(0);
	}

	await writeFile(ROUTES_JSON_PATH, JSON.stringify({ paths: selectedPaths, updatedAt: new Date().toISOString() }, null, '\t') + '\n');
	await writeWranglerToml(selectedPaths);

	const actualUsage = await fetchActualUsage(selectedPaths);
	await sendSummaryEmail({ added, removed, overflowDropped, budgetUsed, actualUsage });

	console.log('Done. cloudflare/routes.json and cloudflare/wrangler.toml updated, summary emailed.');
	process.exit(0);
})().catch(err => {
	console.error('refresh-worker-routes failed:', err);
	process.exit(1);
});
