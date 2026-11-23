const fs = require('node:fs');
const axios = require('./services/axios.js');
const pkg = require('../package.json');

const FILENAME = 'ea45ed4211434d2889a3c62bc69f1600';
const DOMAIN = pkg.homepage.replace('https://', '');
const BATCH_SIZE = 10000;

const parseSitemap = () => {
	const xml = fs.readFileSync('www/public/sitemap.xml', 'utf8');
	return [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1].trim());
};

const submitToIndexNow = async (urls, batchNum, totalBatches) => {
	try {
		const key = fs.readFileSync(`www/public/${FILENAME}.txt`, 'utf8').trim();
		const payload = {
			host: DOMAIN,
			key,
			keyLocation: `https://${DOMAIN}/${FILENAME}.txt`,
			urlList: urls,
		};

		const { status, statusText } = await axios.post('https://api.indexnow.org/indexnow', payload, {
			headers: { 'Content-Type': 'application/json' },
		});

		console.log(`[OK] Batch ${batchNum}/${totalBatches} | ${urls.length} URLs | Response: ${status} ${statusText}`);
	} catch (err) {
		const status = err.response?.status || 'Unknown';
		const body = err.response?.data ? JSON.stringify(err.response.data) : '';
		console.error(`[FAIL] Batch ${batchNum}/${totalBatches} | ${urls.length} URLs | Status: ${status} | ${body} | Msg: ${err.message}`);
	}
};

(async () => {
	console.log('Domain:', DOMAIN);

	const urls = parseSitemap();
	console.log(`Parsed URLs: ${urls.length}`);

	const totalBatches = Math.ceil(urls.length / BATCH_SIZE);

	for (let i = 0; i < urls.length; i += BATCH_SIZE) {
		const chunk = urls.slice(i, i + BATCH_SIZE);
		const batchNum = Math.floor(i / BATCH_SIZE) + 1;
		console.log(`Submitting batch ${batchNum}/${totalBatches} (${chunk.length} URLs, range ${i + 1}-${i + chunk.length})`);
		await submitToIndexNow(chunk, batchNum, totalBatches);
	}

	console.log('All batches processed.');
	process.exit(0);
})().catch(err => {
	console.error('Unexpected error:', err);
	process.exit(1);
});