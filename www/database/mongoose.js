const { connect, connection } = require('mongoose');
const RequestStats = require('./models/request-stats.model.js');

const connectToDatabase = async () => {
	try {
		await connect(process.env.MONGODB_URL, {
			maxPoolSize: 10,
			minPoolSize: 2,
			serverSelectionTimeoutMS: 5000,
			socketTimeoutMS: 45000,
		});
		console.log('MongoDB connected successfully');
	} catch (err) {
		console.error('Failed to connect to MongoDB:', err);
	}
};

connection.on('connected', async () => {
	try {
		const data = await RequestStats.findOne({}).lean();
		if (data) return;

		await RequestStats.create({});
		console.info('RequestStats collection initialized successfully');
	} catch (err) {
		console.error('Failed to initialize `RequestStats`', err);
	}
});

connection.on('disconnected', () => {
	console.warn('MongoDB disconnected!');
});

connection.on('error', err => {
	console.error('MongoDB connection error:', err);
});

module.exports = connectToDatabase;