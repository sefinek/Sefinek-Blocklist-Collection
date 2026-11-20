const { createClient } = require('redis');

const RedisClient = createClient({
	socket: {
		host: process.env.REDIS_HOST,
		port: 6379,
		connectTimeout: 20 * 1000,
		reconnectStrategy: retries => Math.min(retries * 5000, 15000),
	},
	database: 8,
	password: process.env.REDIS_PASSWD,
});

let isDown = false;

RedisClient.on('ready', () => {
	console.log(isDown ? 'Redis connection restored' : 'Connected to Redis successfully');
	isDown = false;
});

RedisClient.on('error', err => {
	if (isDown) return;
	isDown = true;
	console.error('Redis error:', err.message);
});

RedisClient.connect().catch(err => console.error('Redis failed to connect on startup:', err.message));

module.exports = RedisClient;
