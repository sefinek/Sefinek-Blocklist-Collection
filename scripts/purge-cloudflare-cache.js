process.loadEnvFile();
const { join, relative } = require('node:path');
const axios = require('../www/services/axios.js');
const getAllFiles = require('./utils/getAllFiles.js');

const GENERATED_DIR = join(__dirname, '..', 'blocklists', 'generated');
const CHUNK_SIZE = 30;
const ORIGIN = 'https://blocklist.sefinek.net';

const { CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID } = process.env;
if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ZONE_ID) throw new Error('Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ZONE_ID environment variable');

const chunk = (arr, size) => Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));

(async () => {
	const files = await getAllFiles(GENERATED_DIR, ['.txt', '.conf']);
	if (!files.length) return console.log('No generated files found, nothing to purge.');

	const urls = files.map(file => `${ORIGIN}/generated/v1/${relative(GENERATED_DIR, file).replace(/\\/g, '/')}`);

	for (const batch of chunk(urls, CHUNK_SIZE)) {
		await axios.post(`https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/purge_cache`, { files: batch }, {
			headers: { 'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}` },
		});
		console.log(`Purged ${batch.length} URLs`);
	}

	console.log(`Done. Purged ${urls.length} URLs in total.`);
})().catch(err => {
	console.error('Cloudflare cache purge failed:', err.response?.data || err.message);
	process.exit(1);
});
