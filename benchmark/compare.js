const { readFile } = require('node:fs/promises');
const { join } = require('node:path');

const SUMMARY_CSV = join(__dirname, 'results', 'summary.csv');

const [labelA, labelB] = process.argv.slice(2);
if (!labelA || !labelB) {
	console.error('Usage: node benchmark/compare.js <label-before> <label-after>');
	process.exit(1);
}

const parseCsv = text => {
	const [header, ...lines] = text.trim().split('\n');
	const cols = header.split(',');
	return lines.map(line => {
		const values = line.split(',');
		return Object.fromEntries(cols.map((col, i) => [col, values[i]]));
	});
};

const lastByUrl = (rows, label) => {
	const map = new Map();
	for (const row of rows.filter(r => r.label === label)) map.set(row.url, row);
	return map;
};

const round = n => Math.round(n * 100) / 100;

(async () => {
	const rows = parseCsv(await readFile(SUMMARY_CSV, 'utf-8'));

	const before = lastByUrl(rows, labelA);
	const after = lastByUrl(rows, labelB);

	if (!before.size) return console.error(`No rows found for label "${labelA}"`);
	if (!after.size) return console.error(`No rows found for label "${labelB}"`);

	const table = [];
	for (const [url, a] of before) {
		const b = after.get(url);
		if (!b) continue;

		const beforeMs = parseFloat(a.avg_ms);
		const afterMs = parseFloat(b.avg_ms);
		const change = round(((afterMs - beforeMs) / beforeMs) * 100);

		table.push({
			url: url.replace('https://blocklist.sefinek.net', ''),
			[`${labelA} avg (ms)`]: beforeMs,
			[`${labelB} avg (ms)`]: afterMs,
			'change (%)': `${change > 0 ? '+' : ''}${change}%`,
			[`${labelA} cache`]: a.cache_status,
			[`${labelB} cache`]: b.cache_status,
		});
	}

	console.table(table);
})();
