const { Schema, model } = require('mongoose');
const { CategoriesSchema } = require('./request-stats.model.js');

const MinuteStatsSchema = new Schema({
	timestamp: { type: Date, required: true },
	date: { type: String, required: true }, // YYYY-MM-DD
	time: { type: String, required: true }, // HH:mm

	total: { type: Number, default: 0 },
	blocklists: { type: Number, default: 0 },

	categories: { type: CategoriesSchema, default: () => ({}) },
	responses: { type: Map, of: Number, default: () => ({}) },
}, { timestamps: false, versionKey: false, collection: 'minute-stats' });

MinuteStatsSchema.index({ date: 1, time: 1 }, { unique: true });
MinuteStatsSchema.index({ timestamp: 1 });
MinuteStatsSchema.index({ date: 1, timestamp: 1 });

module.exports = model('MinuteStats', MinuteStatsSchema);
