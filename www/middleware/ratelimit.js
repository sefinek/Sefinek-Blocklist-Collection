const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { rateLimit: rateLimitError } = require('./other/errors.js');
const RedisClient = require('../services/redis.js');

const sendCommand = (...args) => RedisClient.sendCommand(args);

const makeLimit = (windowMs, limit, prefix, options = {}) => rateLimit({
	windowMs,
	limit,
	standardHeaders: 'draft-7',
	legacyHeaders: false,
	store: new RedisStore({ sendCommand, prefix }),
	...options,
});

const global = makeLimit(2 * 60 * 1000, 225, 'ratelimit:www:', {
	skip: () => process.env.NODE_ENV === 'development',
	handler: rateLimitError,
});

const blocklistCheck = makeLimit(60 * 1000, 20, 'ratelimit:blocklistCheck:', {
	skip: () => process.env.NODE_ENV === 'development',
	message: { success: false, status: 429, message: 'Too many lookup requests. Please slow down.' },
});

const falsePositiveSubmit = makeLimit(15 * 60 * 1000, 5, 'ratelimit:falsePositiveSubmit:', {
	skip: () => process.env.NODE_ENV === 'development',
	message: { success: false, status: 429, message: 'Too many reports submitted. Please try again later.' },
});

const edgeHit = makeLimit(60 * 1000, 500, 'ratelimit:edgeHit:', {
	skip: () => process.env.NODE_ENV === 'development',
	message: { success: false, status: 429, message: 'Too many edge-hit reports.' },
});

module.exports = { global, blocklistCheck, falsePositiveSubmit, edgeHit };
