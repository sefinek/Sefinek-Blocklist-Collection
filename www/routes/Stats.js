const router = require('express').Router();
const MinuteStats = require('../database/models/minute-stats.model.js');
const RequestStats = require('../database/models/request-stats.model.js');
const withCache = require('../utils/withCache.js');

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 365;
const VALID_INTERVALS = [1, 5, 10, 15, 30, 60, 240, 480, 960, 1440];
const CATEGORY_KEYS = ['hosts', 'localhost', 'adguard', 'dnsmasq', 'noip', 'rpz', 'unbound'];

const pad = n => String(n).padStart(2, '0');
const formatUTCDate = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const formatUTCTime = d => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;

// Cache TTLs (in seconds)
const ALLTIME_CACHE_TTL = 15;
const MINUTE_CACHE_TTL = 5;

const parseDate = dateStr => {
	if (!DATE_REGEX.test(dateStr)) return null;
	const [year, month, day] = dateStr.split('-').map(Number);
	const date = new Date(year, month - 1, day);
	if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
	return date;
};

// Get all-time statistics
router.get('/api/v1/stats/alltime', async (req, res) => {
	try {
		const stats = await withCache('cache:stats:alltime', ALLTIME_CACHE_TTL, () => RequestStats.findOne({}).lean());
		if (!stats) return res.json({ success: true, status: 200, message: 'No data yet.', data: { total: 0, blocklists: 0, categories: {}, responses: {}, serverTime: new Date().toISOString() } });

		res.json({
			success: true,
			status: 200,
			message: 'OK',
			data: {
				total: stats.total || 0,
				blocklists: stats.blocklists || 0,
				categories: stats.categories || {},
				responses: stats.responses || {},
				createdAt: stats.createdAt,
				updatedAt: stats.updatedAt,
				serverTime: new Date().toISOString(),
			},
		});
	} catch (err) {
		console.error('Error fetching all-time stats:', err);
		res.status(500).json({ success: false, status: 500, message: 'Internal server error' });
	}
});

// Get minute stats for a specific date range
// Example: GET /api/v1/stats/minute?from=2024-11-26&to=2024-11-27&interval=10
router.get('/api/v1/stats/minute', async (req, res) => {
	try {
		const { from, to, interval = 1 } = req.query;
		if (!from) return res.status(400).json({ success: false, status: 400, message: 'Missing "from" query parameter (YYYY-MM-DD)' });

		const fromDate = parseDate(from);
		const toDate = to ? parseDate(to) : fromDate;
		if (!fromDate || !toDate) return res.status(400).json({ success: false, status: 400, message: 'Invalid date format. Use YYYY-MM-DD' });

		const today = new Date();
		today.setHours(23, 59, 59, 999);

		if (toDate > today) return res.status(400).json({ success: false, status: 400, message: 'Date cannot be in the future' });
		if (toDate < fromDate) return res.status(400).json({ success: false, status: 400, message: '"to" date cannot be before "from" date' });

		const daysDiff = Math.ceil((toDate - fromDate) / (1000 * 60 * 60 * 24));
		if (daysDiff > MAX_RANGE_DAYS) return res.status(400).json({ success: false, status: 400, message: `Date range cannot exceed ${MAX_RANGE_DAYS} days` });

		const parsedInterval = parseInt(interval) || 1;
		if (!VALID_INTERVALS.includes(parsedInterval)) {
			return res.status(400).json({ success: false, status: 400, message: `Invalid interval. Valid values: ${VALID_INTERVALS.join(', ')}` });
		}

		const minInterval = daysDiff > 30 ? 1440 : daysDiff > 14 ? 60 : daysDiff > 5 ? 10 : 1;
		if (parsedInterval < minInterval) {
			const minLabel = minInterval >= 60 ? (minInterval / 60) + 'h' : minInterval + 'm';
			return res.status(400).json({ success: false, status: 400, message: `For ${daysDiff} days range, minimum interval is ${minLabel}` });
		}

		const cacheKey = `cache:stats:minute:${from}:${to || from}:${parsedInterval}`;
		const query = { date: from };
		if (to && to !== from) query.date = { $gte: from, $lte: to };

		const stats = await withCache(cacheKey, MINUTE_CACHE_TTL, async () => {
			const [{ main, responses }] = await MinuteStats.aggregate([
				{ $match: query },
				{ $addFields: { bucket: { $dateTrunc: { date: '$timestamp', unit: 'minute', binSize: parsedInterval } } } },
				{
					$facet: {
						main: [
							{
								$group: {
									_id: '$bucket',
									total: { $sum: '$total' },
									blocklists: { $sum: '$blocklists' },
									hosts: { $sum: '$categories.hosts' },
									localhost: { $sum: '$categories.localhost' },
									adguard: { $sum: '$categories.adguard' },
									dnsmasq: { $sum: '$categories.dnsmasq' },
									noip: { $sum: '$categories.noip' },
									rpz: { $sum: '$categories.rpz' },
									unbound: { $sum: '$categories.unbound' },
								},
							},
							{ $sort: { _id: 1 } },
						],
						responses: [
							{ $project: { bucket: 1, responses: { $objectToArray: { $ifNull: ['$responses', {}] } } } },
							{ $unwind: '$responses' },
							{ $group: { _id: { bucket: '$bucket', code: '$responses.k' }, count: { $sum: '$responses.v' } } },
							{ $group: { _id: '$_id.bucket', entries: { $push: { k: '$_id.code', v: '$count' } } } },
						],
					},
				},
			]);

			const responsesByBucket = new Map(responses.map(r => [r._id.getTime(), Object.fromEntries(r.entries.map(e => [e.k, e.v]))]));

			return main.map(doc => ({
				timestamp: doc._id.toISOString(),
				date: formatUTCDate(doc._id),
				time: formatUTCTime(doc._id),
				total: doc.total,
				blocklists: doc.blocklists,
				categories: Object.fromEntries(CATEGORY_KEYS.map(key => [key, doc[key]])),
				responses: responsesByBucket.get(doc._id.getTime()) || {},
			}));
		});

		res.json({ success: true, status: 200, message: 'OK', count: stats.length, data: stats, serverTime: new Date().toISOString() });
	} catch (err) {
		console.error('Error fetching minute stats:', err);
		res.status(500).json({ success: false, status: 500, message: 'Internal server error' });
	}
});

module.exports = router;
