const RedisClient = require('../services/redis.js');
const isBot = require('./isBot.js');

const PENDING_SET_TTL_SECONDS = 7 * 24 * 60 * 60;

// Good-bots list is resolved in bulk by scripts/resolve-good-bots.js, not looked up live here.
module.exports = async (userAgent, ip) => {
	if (isBot(userAgent)) return true;
	if (!ip) return false;

	try {
		const cached = await RedisClient.get(`goodbot:${ip}`);
		if (cached !== null) return cached === '1';

		const pipeline = RedisClient.multi();
		pipeline.sAdd('goodbot:pending', ip);
		pipeline.expire('goodbot:pending', PENDING_SET_TTL_SECONDS);
		await pipeline.exec();
	} catch (err) {
		console.error('goodbot Redis lookup failed:', err.message);
	}

	return false;
};
