const { performance } = require('node:perf_hooks');
const { mkdir, writeFile, appendFile, access } = require('node:fs/promises');
const { join } = require('node:path');
const axios = require('../www/services/axios.js');
const URLS = require('./urls.js');

const args = process.argv.slice(2);
const label = args.find(a => !a.startsWith('--')) || `run-${Date.now()}`;
const runsArg = args.find(a => a.startsWith('--runs='));
const hostArg = args.find(a => a.startsWith('--host='));
const RUNS = runsArg ? parseInt(runsArg.split('=')[1], 10) : 5;
const HOST = hostArg ? hostArg.split('=')[1] : 'https://blocklist.sefinek.net';

const RESULTS_DIR = join(__dirname, 'results');
const SUMMARY_CSV = join(RESULTS_DIR, 'summary.csv');
const CSV_HEADER = 'timestamp,label,url,runs,min_ms,avg_ms,median_ms,max_ms,size_bytes,cache_status\n';

const median = values => {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const round = n => Math.round(n * 100) / 100;

const requestOnce = async url => {
	const start = performance.now();
	const res = await axios.get(url, { responseType: 'arraybuffer', validateStatus: () => true });
	const ms = performance.now() - start;
	return { ms, status: res.status, size: res.data.length, cacheStatus: res.headers['cf-cache-status'] || 'n/a', cfRay: res.headers['cf-ray'] || 'n/a' };
};

const benchmarkUrl = async ({ label: urlLabel, path }) => {
	const url = `${HOST}${path}`;
	const samples = [];

	for (let i = 0; i < RUNS; i++) {
		try {
			samples.push(await requestOnce(url));
		} catch (err) {
			console.error(`Request failed for ${url}:`, err.message);
		}
	}

	if (!samples.length) return null;

	const timings = samples.map(s => s.ms);
	return {
		label: urlLabel,
		url,
		runs: samples.length,
		min_ms: round(Math.min(...timings)),
		avg_ms: round(timings.reduce((a, b) => a + b, 0) / timings.length),
		median_ms: round(median(timings)),
		max_ms: round(Math.max(...timings)),
		size_bytes: samples[samples.length - 1].size,
		cache_status: [...new Set(samples.map(s => s.cacheStatus))].join('/'),
	};
};

(async () => {
	await mkdir(RESULTS_DIR, { recursive: true });

	console.log(`Benchmarking ${HOST} - label: "${label}", ${RUNS} runs per URL\n`);

	const results = [];
	for (const entry of URLS) {
		process.stdout.write(`  ${entry.label}...`);
		const result = await benchmarkUrl(entry);
		if (result) results.push(result);
		console.log(result ? ` ${result.avg_ms} ms avg` : ' failed');
	}

	console.table(results.map(r => ({
		label: r.label,
		'min (ms)': r.min_ms,
		'avg (ms)': r.avg_ms,
		'median (ms)': r.median_ms,
		'max (ms)': r.max_ms,
		'size (KB)': round(r.size_bytes / 1024),
		'cf-cache-status': r.cache_status,
	})));

	const timestamp = new Date().toISOString();
	await writeFile(join(RESULTS_DIR, `${timestamp.replace(/[:.]/g, '-')}__${label}.json`), JSON.stringify({ timestamp, label, host: HOST, runs: RUNS, results }, null, 2));

	let hasHeader = true;
	try {
		await access(SUMMARY_CSV);
	} catch {
		hasHeader = false;
	}
	if (!hasHeader) await writeFile(SUMMARY_CSV, CSV_HEADER);

	const rows = results.map(r => `${timestamp},${label},${r.url},${r.runs},${r.min_ms},${r.avg_ms},${r.median_ms},${r.max_ms},${r.size_bytes},${r.cache_status}\n`).join('');
	await appendFile(SUMMARY_CSV, rows);

	console.log(`\nSaved to ${SUMMARY_CSV}`);
})();
