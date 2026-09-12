process.loadEnvFile();
const connectToDatabase = require('./mongoose.js');

const mongoose = require('mongoose');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
	await connectToDatabase();

	const modelsPath = path.join(__dirname, 'models');
	const files = await fs.readdir(modelsPath);
	files.forEach(file => require(path.join(modelsPath, file)));

	await Promise.all(
		Object.entries(mongoose.models).map(async ([name, model]) => {
			await model.syncIndexes();
			console.log(`Synced indexes for: ${name}`);
		})
	);

	await mongoose.disconnect();
	process.exit(0);
})();