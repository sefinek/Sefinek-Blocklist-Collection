const RedisClient = require('./redis.js');
const RequestStats = require('../database/models/request-stats.model.js');
const MinuteStats = require('../database/models/minute-stats.model.js');

const AGGREGATION_INTERVAL = 5 * 60 * 1000; // 5 minutes
const isDev = process.env.NODE_ENV !== 'production';

const CHUNK_SIZE = 100; // Process 100 keys in parallel
const BULK_WRITE_CHUNK_SIZE = 1000; // Write 1000 documents per bulkWrite operation

const scanAllKeys = async pattern => {
	const keys = [];
	let cursor = '0';
	do {
		const result = await RedisClient.scan(cursor, { MATCH: pattern, COUNT: 200 });
		cursor = result.cursor;
		keys.push(...result.keys);
	} while (cursor !== '0');
	return keys;
};

const fetchChunkData = async chunk => {
	try {
		const pipeline = RedisClient.multi();
		for (const key of chunk) pipeline.hGetAll(key);

		const results = await pipeline.exec();
		return chunk.map((key, index) => ({ key, data: results[index] }));
	} catch (err) {
		console.error(`Error fetching Redis chunk (${chunk.length} keys, starting with ${chunk[0]}):`, err.message);
		return chunk.map(key => ({ key, data: null }));
	}
};

const aggregateRedisToMongo = async () => {
	try {
		const allKeys = await scanAllKeys('stats:minute:*');
		if (!allKeys.length) return;

		if (isDev) console.log(`Found ${allKeys.length} minute keys to aggregate`);

		const aggregated = { inc: {} };
		const minuteDocuments = [];
		const keysToDelete = [];

		for (let i = 0; i < allKeys.length; i += CHUNK_SIZE) {
			const chunk = allKeys.slice(i, i + CHUNK_SIZE);
			const results = await fetchChunkData(chunk);

			for (const result of results) {
				if (!result) continue;
				const { key, data } = result;

				try {
					if (!data || Object.keys(data).length === 0) {
						if (isDev) console.warn(`Empty data for key: ${key}`);
						continue;
					}

					// Parse date from key: stats:minute:YYYY-MM-DD:HH:mm
					const parts = key.split(':');

					if (parts.length !== 5) {
						if (isDev) console.warn(`Invalid key format: ${key}`);
						continue;
					}

					const date = parts[2]; // YYYY-MM-DD
					const hour = parts[3]; // HH
					const minute = parts[4]; // mm
					const time = `${hour}:${minute}`;

					const dateParts = date.split('-');
					if (dateParts.length !== 3) {
						if (isDev) console.warn(`Invalid date format in key: ${key}`);
						continue;
					}

					const timestamp = new Date(Date.UTC(
						parseInt(dateParts[0], 10),
						parseInt(dateParts[1], 10) - 1,
						parseInt(dateParts[2], 10),
						parseInt(hour, 10),
						parseInt(minute, 10),
						0, 0
					));

					if (isNaN(timestamp.getTime())) {
						if (isDev) console.warn(`Invalid timestamp for key: ${key}`);
						continue;
					}

					const minuteDoc = {
						timestamp,
						date,
						time,
						total: parseInt(data.total || 0, 10),
						blocklists: parseInt(data.blocklists || 0, 10),
						categories: {
							hosts: 0,
							localhost: 0,
							adguard: 0,
							dnsmasq: 0,
							noip: 0,
							rpz: 0,
							unbound: 0,
						},
						responses: {},
					};

					if (minuteDoc.total) aggregated.inc.total = (aggregated.inc.total || 0) + minuteDoc.total;
					if (minuteDoc.blocklists) aggregated.inc.blocklists = (aggregated.inc.blocklists || 0) + minuteDoc.blocklists;

					for (const [field, value] of Object.entries(data)) {
						if (field.startsWith('categories:')) {
							const category = field.slice('categories:'.length);
							const n = parseInt(value, 10);
							minuteDoc.categories[category] = n;
							aggregated.inc[`categories.${category}`] = (aggregated.inc[`categories.${category}`] || 0) + n;
						} else if (field.startsWith('responses:')) {
							const code = field.slice('responses:'.length);
							const n = parseInt(value, 10);
							minuteDoc.responses[code] = n;
							aggregated.inc[`responses.${code}`] = (aggregated.inc[`responses.${code}`] || 0) + n;
						}
					}

					minuteDocuments.push(minuteDoc);
					keysToDelete.push(key);
				} catch (err) {
					console.error(`Error processing key ${key}:`, err.message);
				}
			}
		}

		if (minuteDocuments.length > 0) {
			try {
				const operations = minuteDocuments.map(doc => ({
					updateOne: {
						filter: { date: doc.date, time: doc.time },
						update: {
							$setOnInsert: {
								timestamp: doc.timestamp,
								date: doc.date,
								time: doc.time,
							},
							$inc: {
								total: doc.total,
								blocklists: doc.blocklists,
								'categories.hosts': doc.categories.hosts,
								'categories.localhost': doc.categories.localhost,
								'categories.adguard': doc.categories.adguard,
								'categories.dnsmasq': doc.categories.dnsmasq,
								'categories.noip': doc.categories.noip,
								'categories.rpz': doc.categories.rpz,
								'categories.unbound': doc.categories.unbound,
								...Object.fromEntries(
									Object.entries(doc.responses).map(([k, v]) => [`responses.${k}`, v])
								),
							},
						},
						upsert: true,
					},
				}));

				for (let i = 0; i < operations.length; i += BULK_WRITE_CHUNK_SIZE) {
					const chunk = operations.slice(i, i + BULK_WRITE_CHUNK_SIZE);
					await MinuteStats.bulkWrite(chunk);
					if (isDev) console.log(`Saved chunk ${Math.floor(i / BULK_WRITE_CHUNK_SIZE) + 1}: ${chunk.length} documents`);
				}

				if (isDev) console.log(`Saved ${minuteDocuments.length} minute documents to minute-stats`);
			} catch (err) {
				console.error('Failed to save minute documents:', err.message);
			}
		}

		if (Object.keys(aggregated.inc).length > 0) {
			try {
				await RequestStats.findOneAndUpdate(
					{},
					{
						$inc: aggregated.inc,
						$set: { updatedAt: new Date() },
					},
					{ upsert: true }
				);
				if (isDev) console.log(`Updated request-stats: +${aggregated.inc.total || 0} requests, +${aggregated.inc.blocklists || 0} blocklists`);
			} catch (err) {
				console.error('Failed to update request-stats:', err.message);
			}
		}

		if (keysToDelete.length > 0) {
			try {
				await RedisClient.del(keysToDelete);
				if (isDev) console.log(`Deleted ${keysToDelete.length} processed keys from Redis`);
			} catch (err) {
				console.error('Failed to delete keys:', err.message);
			}
		}

		console.log(`Aggregation completed: ${minuteDocuments.length} minutes, +${aggregated.inc.total || 0} requests, +${aggregated.inc.blocklists || 0} blocklists`);

	} catch (err) {
		console.error('Failed:', err);
	}
};

const startAggregationJob = () => {
	if (isDev) console.log(`Job started, running every ${AGGREGATION_INTERVAL / 1000 / 60} minutes`);
	void aggregateRedisToMongo();
	setInterval(aggregateRedisToMongo, AGGREGATION_INTERVAL);
};

module.exports = { startAggregationJob, aggregateRedisToMongo };
