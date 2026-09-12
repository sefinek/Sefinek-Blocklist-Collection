process.loadEnvFile();
const RedisClient = require('../www/services/redis.js');
const checkGoodBotsBulk = require('./utils/goodBotBulkCheck.js');

const GOODBOT_TTL_SECONDS = 24 * 60 * 60;
const { GOODBOT_WS_URL, GOODBOT_WS_SECRET } = process.env;

(async () => {
	if (!GOODBOT_WS_URL || !GOODBOT_WS_SECRET) {
		console.log('GOODBOT_WS_URL/GOODBOT_WS_SECRET not configured, skipping.');
		process.exit(0);
	}

	const pending = await RedisClient.sMembers('goodbot:pending');
	if (!pending.length) {
		console.log('No pending IPs to resolve.');
		process.exit(0);
	}

	const results = await checkGoodBotsBulk(pending, { url: GOODBOT_WS_URL, secret: GOODBOT_WS_SECRET });

	const pipeline = RedisClient.multi();
	for (const ip of pending) {
		const r = results[ip];
		pipeline.set(`goodbot:${ip}`, r?.whitelisted ? '1' : '0', { EX: GOODBOT_TTL_SECONDS });
		pipeline.sRem('goodbot:pending', ip);
	}
	await pipeline.exec();

	console.log(`Resolved ${pending.length} IP(s) against the good-bots list.`);
	process.exit(0);
})().catch(err => {
	console.error('resolve-good-bots failed:', err.message);
	process.exit(1);
});
