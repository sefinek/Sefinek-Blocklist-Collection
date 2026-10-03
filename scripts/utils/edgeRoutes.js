const { readFile, writeFile, rename, mkdir } = require('node:fs/promises');
const { join } = require('node:path');
const axios = require('../../www/services/axios.js');
const withRetry = require('./withRetry.js');
const isRetryableHttpError = require('./isRetryableHttpError.js');

const HOST = 'blocklist.sefinek.net';
const WORKER_SCRIPT_NAME = 'sefinek-blocklist-edge-cache';
const WORKERS_FREE_CAP = 100000;
const WARNING_THRESHOLD = 0.8 * WORKERS_FREE_CAP;
const CRITICAL_THRESHOLD = 0.95 * WORKERS_FREE_CAP;

// Runtime state, not config - gitignored so deploys (git reset --hard) never clobber it.
// Cloudflare is the source of truth for which routes are live; this file tracks intent around it.
const DATA_DIR = join(__dirname, '..', '..', 'data');
const STATE_PATH = join(DATA_DIR, 'edge-routes.json');

const getCredentials = () => {
	const { CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID } = process.env;
	if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ZONE_ID) throw new Error('Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ZONE_ID environment variable');
	return { token: CLOUDFLARE_API_TOKEN, zoneId: CLOUDFLARE_ZONE_ID };
};

const routesApi = (method, suffix = '', data) => {
	const { token, zoneId } = getCredentials();
	return withRetry(() => axios({
		method,
		url: `https://api.cloudflare.com/client/v4/zones/${zoneId}/workers/routes${suffix}`,
		data,
		headers: { Authorization: `Bearer ${token}` },
	}), { baseMs: 1000, isRetryable: isRetryableHttpError });
};

const toPath = pattern => pattern.slice(HOST.length);

const listLiveRoutes = async () => {
	const res = await routesApi('get');
	return (res.data.result || [])
		.filter(r => r.script === WORKER_SCRIPT_NAME && r.pattern.startsWith(`${HOST}/`))
		.map(r => ({ id: r.id, path: toPath(r.pattern) }));
};

const removeRoutes = async routes => {
	const results = await Promise.allSettled(routes.map(r => routesApi('delete', `/${r.id}`)));
	const removed = new Set();
	const failed = new Set();
	results.forEach((result, i) => {
		if (result.status === 'fulfilled') return removed.add(routes[i].path);
		console.error(`Failed to remove route ${routes[i].path}:`, result.reason?.message);
		failed.add(routes[i].path);
	});
	return { removed, failed };
};

// Returns the paths that are actually live afterwards. A retried POST can fail as a duplicate when the
// first attempt was applied but its response lost, so failures are confirmed against the live list.
const addRoutes = async paths => {
	const results = await Promise.allSettled(paths.map(path => routesApi('post', '', { pattern: `${HOST}${path}`, script: WORKER_SCRIPT_NAME })));
	if (results.every(r => r.status === 'fulfilled')) return paths;

	let live;
	try {
		live = new Set((await listLiveRoutes()).map(r => r.path));
	} catch (err) {
		console.error('Failed to verify added routes, assuming failed requests did not apply:', err.message);
		live = new Set(paths.filter((_, i) => results[i].status === 'fulfilled'));
	}

	return paths.filter((path, i) => {
		if (results[i].status === 'fulfilled' || live.has(path)) return true;
		console.error(`Failed to add route ${path}:`, results[i].reason?.message);
		return false;
	});
};

const writeJsonAtomic = async (path, data) => {
	await mkdir(DATA_DIR, { recursive: true });
	const tmpPath = `${path}.${process.pid}.tmp`;
	await writeFile(tmpPath, JSON.stringify(data, null, '\t') + '\n');
	await rename(tmpPath, path);
};

const readJson = async (path, fallback) => {
	try {
		return JSON.parse(await readFile(path, 'utf-8'));
	} catch (err) {
		if (err.code === 'ENOENT') return fallback;
		throw err;
	}
};

const writeState = state => writeJsonAtomic(STATE_PATH, state);

// Missing state (fresh checkout/server) is rebuilt from what's live on Cloudflare rather than assumed empty,
// otherwise the watchdog would ignore routes that still count against the cap
const readState = async () => {
	const state = await readJson(STATE_PATH, null);
	if (state) return state;

	const paths = (await listLiveRoutes()).map(r => r.path);
	const bootstrapped = { paths, updatedAt: new Date().toISOString() };
	await writeState(bootstrapped);
	console.log(`No ${STATE_PATH} found, bootstrapped from ${paths.length} live Cloudflare route(s)`);
	return bootstrapped;
};

// `paths` is kept sorted by popularity. While an emergency splits routes between `paths` and
// `emergencyRemovedPaths`, the combined order lives in `popularityRank` so it survives until full recovery.
const getPopularityRank = state => state.popularityRank ?? [...new Set([...state.paths, ...(state.emergencyRemovedPaths ?? [])])];

const sortByRank = (paths, rank) => {
	const index = new Map(rank.map((p, i) => [p, i]));
	const pos = p => index.get(p) ?? rank.length;
	return [...paths].sort((a, b) => pos(a) - pos(b));
};

module.exports = {
	HOST,
	WORKER_SCRIPT_NAME,
	WORKERS_FREE_CAP,
	WARNING_THRESHOLD,
	CRITICAL_THRESHOLD,
	DATA_DIR,
	STATE_PATH,
	getCredentials,
	listLiveRoutes,
	removeRoutes,
	addRoutes,
	readJson,
	writeJsonAtomic,
	readState,
	writeState,
	getPopularityRank,
	sortByRank,
};
