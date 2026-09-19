const crypto = require('node:crypto');
const router = require('express').Router();
const isBotRequest = require('../utils/isBotRequest.js');
const { incrementBlocklistStats } = require('../middleware/other/stats-redis.js');
const { edgeHit: edgeHitLimiter } = require('../middleware/ratelimit.js');

const timingSafeEqual = (a, b) => {
	const bufA = Buffer.from(String(a));
	const bufB = Buffer.from(String(b));
	return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
};

// Called by the Cloudflare Worker (cloudflare/worker.js) when it serves a request straight from the
// edge cache without ever reaching this origin - reuses the same Redis counters a normal request would
// hit, so stats stay accurate regardless of where a request was actually served from.
router.post('/api/v1/edge/hit', edgeHitLimiter, async (req, res) => {
	const secret = process.env.EDGE_STATS_SECRET;
	if (!secret || !timingSafeEqual(req.headers['x-edge-stats-secret'] || '', secret)) {
		return res.status(403).json({ success: false, status: 403, message: 'Forbidden' });
	}

	const { path, userAgent, ip } = req.body || {};
	if (typeof path !== 'string' || !path) return res.status(400).json({ success: false, status: 400, message: 'Missing "path"' });
	if (await isBotRequest(userAgent, ip)) return res.json({ success: true, status: 200, message: 'Ignored (bot)' });

	await incrementBlocklistStats(path, 200);
	res.json({ success: true, status: 200, message: 'OK' });
});

module.exports = router;
