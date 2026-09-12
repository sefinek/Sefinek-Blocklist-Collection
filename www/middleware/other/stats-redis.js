const RedisClient = require('../../services/redis.js');
const parseCategoryFromLink = require('../../utils/parseCategoryFromLink.js');
const isBotRequest = require('../../utils/isBotRequest.js');

const FILEPOP_TTL_SECONDS = 14 * 24 * 60 * 60;

const getMinuteKey = () => {
	const now = new Date();
	const iso = now.toISOString();
	return `stats:minute:${iso.slice(0, 10)}:${iso.slice(11, 13)}:${iso.slice(14, 16)}`;
};

const getFilepopKey = () => `stats:filepop:${new Date().toISOString().slice(0, 10)}`;

const incrementBlocklistStats = async (url, statusCode) => {
	try {
		const { type } = parseCategoryFromLink(url);
		const minuteKey = getMinuteKey();

		const pipeline = RedisClient.multi();

		// Increment total requests
		pipeline.hIncrBy(minuteKey, 'total', 1);
		pipeline.hIncrBy(minuteKey, `responses:${statusCode}`, 1);

		// Track blocklist requests
		if (type && statusCode >= 200 && statusCode <= 304 && (url.includes('.txt') || url.includes('.conf'))) {
			pipeline.hIncrBy(minuteKey, 'blocklists', 1);
			pipeline.hIncrBy(minuteKey, `categories:${type}`, 1);

			// Per-file popularity, used by scripts/refresh-worker-routes.js to pick edge-cache candidates
			const filepopKey = getFilepopKey();
			pipeline.zIncrBy(filepopKey, 1, url.split('?')[0]);
			pipeline.expire(filepopKey, FILEPOP_TTL_SECONDS);
		}

		// Set TTL to 48 hours as backup (keys are deleted after aggregation, but kept if server is down)
		pipeline.expire(minuteKey, 172800);

		await pipeline.exec();
	} catch (err) {
		// Silent fail - don't block requests if Redis has issues
		console.error('Redis stats update failed:', err.message);
	}
};

const updateStats = async (req, res) => {
	if (req.method !== 'GET') return;
	if (await isBotRequest(req.headers['user-agent'], req.ip)) return;

	const url = req.originalUrl || req.url;
	const statusCode = res?.statusCode ?? 'unknown';
	return incrementBlocklistStats(url, statusCode);
};

module.exports = (req, res, next) => {
	res.on('finish', () => updateStats(req, res));
	next();
};

module.exports.incrementBlocklistStats = incrementBlocklistStats;
