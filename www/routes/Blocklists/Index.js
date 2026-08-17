const router = require('express').Router();
const Marked = require('marked');
const fs = require('node:fs/promises');
const path = require('node:path');

const PATHS = {
	GENERATED: path.join(__dirname, '..', '..', '..', 'blocklists', 'generated'),
	LOGS: path.join(__dirname, '..', '..', 'public', 'logs'),
	DOCS: path.join(__dirname, '..', '..', '..', 'docs'),
};

const FILE_CACHE = new Map();
const FILE_EXISTENCE_CACHE = new Map();
const CACHE_EXPIRATION_TIME = 5 * 60 * 60 * 1000;

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'];
const TEXT_FILE_EXTENSIONS = new Set(['.txt', '.conf', '.log', '.md']);
const SENDFILE_EXTENSIONS = new Set(['.txt', '.conf', '.log']);

const CANONICAL_REGEX = /^\[\/\/]:\s*#\s*\(Canonical:\s*(.*)\)/mi;

const formatFileSize = bytes => {
	if (bytes === 0) return 'Empty';
	const exponent = Math.min(Math.floor(Math.log10(bytes) / 3), SIZE_UNITS.length - 1);
	return `${(bytes / 1000 ** exponent).toFixed(2)} ${SIZE_UNITS[exponent]}`;
};

const getFileIcon = (fileName, isDirectory) =>
	isDirectory ? 'folder.png'
		: TEXT_FILE_EXTENSIONS.has(path.extname(fileName).toLowerCase()) ? 'word.png'
			: 'unknown-file.png';

const getDirStats = async dirPath => {
	try {
		const entries = await fs.readdir(dirPath, { withFileTypes: true });
		let size = 0;
		let newestMtime = 0;
		for (const entry of entries) {
			const fullPath = path.join(dirPath, entry.name);
			if (entry.isDirectory()) {
				const sub = await getDirStats(fullPath);
				size += sub.size;
				if (sub.newestMtime > newestMtime) newestMtime = sub.newestMtime;
			} else {
				const stat = await fs.stat(fullPath);
				size += stat.size;
				if (stat.mtimeMs > newestMtime) newestMtime = stat.mtimeMs;
			}
		}
		return { size, newestMtime };
	} catch {
		return { size: 0, newestMtime: 0 };
	}
};

const getCachedFiles = async (dirPath, validExtensions, sortByDate = false) => {
	const now = Date.now();
	const cacheKey = `${dirPath}:${sortByDate}`;
	const cached = FILE_CACHE.get(cacheKey);
	if (cached && now - cached.timestamp < CACHE_EXPIRATION_TIME) return cached.data;

	const entries = await fs.readdir(dirPath, { withFileTypes: true });
	const fileList = await Promise.all(
		entries
			.filter(entry => {
				const name = entry.name?.trim();
				if (!name || name.startsWith('.')) return false;
				if (!entry.isDirectory()) {
					const ext = path.extname(name).toLowerCase();
					if (!ext || !validExtensions.has(ext)) return false;
				}
				return true;
			})
			.map(async entry => {
				const name = entry.name;
				const fullPath = path.join(dirPath, name);
				const stats = await fs.stat(fullPath);
				const isDir = entry.isDirectory();
				let lastModified, size;
				if (isDir) {
					const dirStats = await getDirStats(fullPath);
					size = dirStats.size;
					lastModified = dirStats.newestMtime || stats.mtimeMs;
				} else {
					size = stats.size;
					lastModified = stats.mtimeMs;
				}

				return { name, isDirectory: isDir, lastModified, icon: getFileIcon(name, isDir), formattedSize: formatFileSize(size) };
			})
	);

	if (sortByDate) {
		fileList.sort((a, b) => a.isDirectory === b.isDirectory ? b.lastModified - a.lastModified : a.isDirectory ? -1 : 1);
	} else {
		fileList.sort((a, b) => a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1);
	}

	FILE_CACHE.set(cacheKey, { data: fileList, timestamp: now });
	return fileList;
};

const extractMatch = (regex, content) => regex.exec(content)?.[1] ?? null;

const sendFile = (res, filePath) => {
	res.sendFile(filePath, err => {
		if (!err || res.headersSent) return;
		if (err.status !== 416) console.error(err);
		res.status(err.status || 500).end();
	});
};

const handleRequest = async (req, res, baseDir, basePath, validExtensions, template, sortByDate = false) => {
	const relative = (req.params[0] || '').replace(/\/$/, '');
	const filePath = path.join(baseDir, relative);
	const isAjax = req.headers['x-requested-with'] === 'XMLHttpRequest';

	if (filePath !== baseDir && !filePath.startsWith(baseDir + path.sep)) {
		if (isAjax) return res.status(403).json({ success: false, status: 403, message: 'Forbidden' });
		return res.status(403).end();
	}

	if (relative.length > 512) {
		if (isAjax) return res.status(414).json({ success: false, status: 414, message: 'Path too long' });
		return res.status(414).end();
	}

	try {
		const now = Date.now();
		let cached = FILE_EXISTENCE_CACHE.get(filePath);
		if (!cached || now - cached.timestamp >= CACHE_EXPIRATION_TIME) {
			const stats = await fs.stat(filePath);
			cached = { stats, timestamp: now };
			FILE_EXISTENCE_CACHE.set(filePath, cached);
		}

		const stats = cached.stats;
		if (stats.isFile()) {
			const ext = path.extname(filePath);
			if (SENDFILE_EXTENSIONS.has(ext)) return sendFile(res, filePath);

			if (ext === '.md') {
				const markdown = await fs.readFile(filePath, 'utf-8');
				const html = Marked.parse(markdown);
				return res.render('markdown-viewer.ejs', { html, title: extractMatch(/#\s(.+)/, markdown) || '', canonical: markdown.match(CANONICAL_REGEX)?.[1] });
			}

			return sendFile(res, filePath);
		}

		if (stats.isDirectory()) {
			const files = await getCachedFiles(filePath, validExtensions, sortByDate);
			const currentPath = path.join(basePath, relative).replace(/\\/g, '/');
			if (isAjax) return res.json({ success: true, status: 200, files, currentPath });

			return res.render(template, { files, currentPath });
		}

		sendFile(res, filePath);
	} catch (err) {
		if (err.code !== 'ENOENT' && err.code !== 'ENAMETOOLONG') console.error(err);
		const status = err.code === 'ENOENT' ? 404 : err.code === 'ENAMETOOLONG' ? 414 : 500;
		if (isAjax) return res.status(status).json({ success: false, status, message: err.code === 'ENOENT' ? 'Not found' : err.code === 'ENAMETOOLONG' ? 'Path too long' : 'Server error' });

		res.status(status).end();
	}
};

// Routes
const EXT_GENERATED = new Set(['.txt', '.conf']);
const EXT_LOGS = new Set(['.log']);
const EXT_DOCS = new Set(['.md']);

router.get(/^\/generated\/v1(.*)$/, (req, res) => handleRequest(req, res, PATHS.GENERATED, '/generated/v1', EXT_GENERATED, 'explorer/file.ejs'));
router.get(/^\/logs\/v1(.*)$/, (req, res) => handleRequest(req, res, PATHS.LOGS, '/logs/v1', EXT_LOGS, 'explorer/log.ejs', true));
router.get(/^\/docs(.*)$/, (req, res) => handleRequest(req, res, PATHS.DOCS, '/docs', EXT_DOCS, 'explorer/markdown.ejs'));

module.exports = router;