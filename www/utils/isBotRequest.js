const RedisClient = require('../services/redis.js');
const isBot = require('./isBot.js');

const PENDING_SET_TTL_SECONDS = 7 * 24 * 60 * 60;

// UA regex first (cheap, catches most cases). For anything it misses, consult the local
// good-bots cache (resolved in bulk by scripts/resolve-good-bots.js, not looked up live here -
// a network round trip per request isn't worth it). An IP not seen yet is queued for the next
// resolve run and treated as "not a bot" for this request.
module.exports = async (userAgent, ip) => {
	if (isBot(userAgent)) return true;
	if (!ip) return false;

	const cached = await RedisClient.get(`goodbot:${ip}`);
	if (cached !== null) return cached === '1';

	const pipeline = RedisClient.multi();
	pipeline.sAdd('goodbot:pending', ip);
	pipeline.expire('goodbot:pending', PENDING_SET_TTL_SECONDS);
	await pipeline.exec();

	return false;
};
