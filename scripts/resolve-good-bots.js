process.loadEnvFile();
const RedisClient = require('../www/services/redis.js');
const checkGoodBotsBulk = require('./utils/goodBotBulkCheck.js');

const GOODBOT_TTL_SECONDS = 24 * 60 * 60;

const resolveGoodBots = async () => {
	const { GOODBOT_WS_URL, GOODBOT_WS_SECRET } = process.env;
	if (!GOODBOT_WS_URL || !GOODBOT_WS_SECRET) return console.log('GOODBOT_WS_URL/GOODBOT_WS_SECRET not configured, skipping');

	const pending = await RedisClient.sMembers('goodbot:pending');
	if (!pending.length) return console.log('No pending IPs to resolve');

	const results = await checkGoodBotsBulk(pending, { url: GOODBOT_WS_URL, secret: GOODBOT_WS_SECRET });

	const pipeline = RedisClient.multi();
	for (const ip of pending) {
		const r = results[ip];
		pipeline.set(`goodbot:${ip}`, r?.whitelisted ? '1' : '0', { EX: GOODBOT_TTL_SECONDS });
		pipeline.sRem('goodbot:pending', ip);
	}
	await pipeline.exec();

	console.log(`Resolved ${pending.length} IP(s) against the good-bots list`);
};

module.exports = resolveGoodBots;

// Runnable directly for manual/CLI use; www/cron/index.js instead requires and calls this
// in-process so the frequent (every 2 min) schedule reuses the already-open Redis connection
// instead of spawning a new Node process (and a new Redis connection) on every tick.
if (require.main === module) {
	resolveGoodBots()
		.then(() => process.exit(0))
		.catch(err => {
			console.error('resolve-good-bots failed:', err.message);
			process.exit(1);
		});
}
