process.loadEnvFile();

const cluster = require('node:cluster');
const numCPUs = require('node:os').availableParallelism();
const connectToDatabase = require('./database/mongoose.js');
const { startAggregationJob } = require('./services/aggregateStats.js');

const { NODE_ENV, DOMAIN, PORT, MONGODB_URL } = process.env;
if (!NODE_ENV || !DOMAIN || !PORT) throw new Error('Missing basic environment variables');
if (!MONGODB_URL) throw new Error('Missing MongoDB connection URL');

(async () => {
	// Development mode - single process
	if (NODE_ENV === 'development') {
		await connectToDatabase();
		require('./services/redis.js');
		startAggregationJob();
		require('./server.js');
		require('./websocket.js');
		return;
	}

	// Production mode - cluster with primary + workers
	if (cluster.isPrimary) {
		await connectToDatabase();
		require('./services/redis.js');
		require('./websocket.js');

		// Start Redis → MongoDB aggregation job (runs every 5 minutes)
		startAggregationJob();

		// Fork workers (one per CPU core)
		for (let i = 0; i < numCPUs; i++) {
			cluster.fork();
		}

		let readyWorkers = 0;
		let pm2Notified = false;
		cluster.on('message', (worker, msg) => {
			if (msg !== 'ready' || pm2Notified) return;
			if (++readyWorkers >= numCPUs) {
				pm2Notified = true;
				if (process.send) process.send('ready');
			}
		});

		// Auto-restart workers on crash
		cluster.on('exit', (worker, code, signal) => {
			console.error(`Worker ${worker.process.pid} died (code: ${code}, signal: ${signal}). Restarting...`);
			cluster.fork();
		});

		console.log(`Primary ${process.pid} running at ${DOMAIN}:${PORT}`);
	} else {
		// Worker process - handles HTTP requests
		await connectToDatabase();
		require('./services/redis.js');
		require('./server.js');
		console.log(`Worker ${process.pid} started`);
	}
})();