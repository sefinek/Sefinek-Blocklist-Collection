process.loadEnvFile();
const { join, relative } = require('node:path');
const axios = require('../www/services/axios.js');
const getAllFiles = require('./utils/getAllFiles.js');
const withRetry = require('./utils/withRetry.js');

const GENERATED_DIR = join(__dirname, '..', 'blocklists', 'generated');
const CHUNK_SIZE = 30;
const BATCH_DELAY_MS = 750;
const RATE_LIMIT_ERROR_CODE = 1134;
const MAX_RETRIES = 3;
const ORIGIN = 'https://blocklist.sefinek.net';

const { CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID } = process.env;
if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ZONE_ID) throw new Error('Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ZONE_ID environment variable');

const chunk = (arr, size) => Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Retry Cloudflare's own rate limit (1134) as well as generic transient failures - a bare
// network error (timeout, ECONNRESET) has no err.response at all and was previously treated
// as permanent, aborting the whole batch on the first hiccup despite the retry scaffolding.
const isRetryable = err => {
	if (err.response?.data?.errors?.some(e => e.code === RATE_LIMIT_ERROR_CODE)) return true;
	return !err.response || err.response.status >= 500;
};

const purgeBatch = async batch => {
	try {
		await withRetry(() => axios.post(`https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/purge_cache`, { files: batch }, {
			headers: { 'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}` },
		}), {
			maxRetries: MAX_RETRIES,
			baseMs: BATCH_DELAY_MS,
			isRetryable,
			onRetry: (err, attempt, delay) => console.warn(`Purge batch failed, retrying in ${delay}ms (attempt ${attempt}/${MAX_RETRIES}):`, err.response?.data || err.message),
		});
		return true;
	} catch (err) {
		console.error('Failed to purge batch:', err.response?.data || err.message);
		return false;
	}
};

(async () => {
	const files = await getAllFiles(GENERATED_DIR, ['.txt', '.conf']);
	if (!files.length) return console.log('No generated files found, nothing to purge');

	const urls = files.map(file => `${ORIGIN}/generated/v1/${relative(GENERATED_DIR, file).replace(/\\/g, '/')}`);
	const batches = chunk(urls, CHUNK_SIZE);

	let purgedCount = 0;
	let failedBatches = 0;
	for (const [i, batch] of batches.entries()) {
		const ok = await purgeBatch(batch);
		if (ok) {
			purgedCount += batch.length;
			console.log(`Purged ${batch.length} URLs`);
		} else {
			failedBatches++;
		}

		if (i < batches.length - 1) await sleep(BATCH_DELAY_MS);
	}

	console.log(`Done. Purged ${purgedCount}/${urls.length} URLs (${failedBatches} batch(es) failed)`);
	if (failedBatches) process.exit(1);
})().catch(err => {
	console.error('Cloudflare cache purge failed:', err.response?.data || err.message);
	process.exit(1);
});
