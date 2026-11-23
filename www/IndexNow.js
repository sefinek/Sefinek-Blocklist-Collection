const fs = require('node:fs');
const axios = require('./services/axios.js');
const pkg = require('../package.json');

const DOMAIN = pkg.homepage.replace('https://', '');
const BATCH_SIZE = 10000;

// Every site has its own key: the one www/public/<key>.txt file whose content equals its name (IndexNow requirement)
const findKey = () => {
	const keys = fs.readdirSync('www/public')
		.filter(file => (/^[a-zA-Z0-9-]{8,128}\.txt$/).test(file))
		.map(file => file.slice(0, -4))
		.filter(key => fs.readFileSync(`www/public/${key}.txt`, 'utf8').trim() === key);
	if (keys.length !== 1) throw new Error(`Expected exactly one IndexNow key file in www/public/, found ${keys.length}`);
	return keys[0];
};

const parseSitemap = () => {
	const xml = fs.readFileSync('www/public/sitemap.xml', 'utf8');
	return [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1].trim());
};

const submitToIndexNow = async (urls, batchNum, totalBatches) => {
	try {
		const key = findKey();
		const payload = {
			host: DOMAIN,
			key,
			keyLocation: `https://${DOMAIN}/${key}.txt`,
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