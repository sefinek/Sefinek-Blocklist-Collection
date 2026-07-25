const fs = require('node:fs/promises');
const path = require('node:path');
const withCache = require('../utils/withCache.js');

const NOIP_DIR = path.resolve(__dirname, '../../blocklists/generated/noip');
const FILE_INDEX_TTL = 2 * 60 * 60 * 1000;
const DOMAIN_CACHE_TTL = process.env.NODE_ENV === 'development' ? 60 : 2 * 60 * 60;
const GITHUB_BASE = 'https://github.com/sefinek/Sefinek-Blocklist-Collection/blob/blocklists/blocklists/generated/noip';

const getTextFiles = async dir => {
	const entries = await fs.readdir(dir, { withFileTypes: true });
	const results = await Promise.all(entries.map(entry => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return getTextFiles(full);
		if (entry.name.endsWith('.txt')) return [full];
		return [];
	}));
	return results.flat();
};

const parsePath = filePath => {
	const rel = path.relative(NOIP_DIR, filePath);
	const parts = rel.split(path.sep);
	const urlPath = parts.join('/');
	return {
		category: parts[0] ?? null,
		source: parts[1] ?? null,
		file: parts[2] ?? null,
		githubUrl: `${GITHUB_BASE}/${urlPath}`,
		siteUrl: `/generated/v1/noip/${urlPath}`,
	};
};

let fileIndexPromise = null;

const buildFileIndex = async () => {
	const files = await getTextFiles(NOIP_DIR);
	const entries = await Promise.all(files.map(async filePath => {
		const content = await fs.readFile(filePath, 'utf8');
		const domains = new Set(content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')));
		return [filePath, { meta: parsePath(filePath), domains }];
	}));
	return new Map(entries);
};

const getFileIndex = () => {
	if (!fileIndexPromise) {
		fileIndexPromise = buildFileIndex().catch(err => {
			fileIndexPromise = null;
			throw err;
		});
		setTimeout(() => { fileIndexPromise = null; }, FILE_INDEX_TTL);
	}
	return fileIndexPromise;
};

exports.searchDomain = async domain => withCache(`blocklist:check:${domain}`, DOMAIN_CACHE_TTL, async () => {
	const index = await getFileIndex();
	const matches = [];
	for (const { meta, domains } of index.values()) {
		if (domains.has(domain)) matches.push(meta);
	}
	return { found: matches.length > 0, matches };
});
