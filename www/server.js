const express = require('express');
const helmet = require('helmet');
const isProd = process.env.NODE_ENV === 'production';

// Middleware imports
const timeout = require('./middleware/timeout.js');
const morgan = require('./middleware/morgan.js');
const { global: limiter } = require('./middleware/ratelimit.js');
const updateStats = require('./middleware/other/stats-redis.js');
const { notFound, internalError } = require('./middleware/other/errors.js');

// Create express instance
const app = express();

// Configure the app
if (isProd) app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', './www/views');

// Use middlewares
app.use(helmet({
	contentSecurityPolicy: {
		directives: {
			scriptSrc: ['\'self\'', 'https://cdn.jsdelivr.net'],
			imgSrc: ['\'self\'', 'https://sefinek.net', 'https://cdn.sefinek.net'],
			connectSrc: ['\'self\'', 'https://blocklist.sefinek.net', 'ws:', 'wss:', 'https://cdn.jsdelivr.net'],
		},
	},
	crossOriginResourcePolicy: false,
}));
app.use(express.static('./www/public'));
app.use(express.json({ limit: '8kb' }));
app.use(express.urlencoded({ extended: false, limit: '8kb' }));
app.use(morgan);
if (isProd) app.use(limiter);
app.use(timeout());

// Routes
const IndexRouter = require('./routes/Index.js');
const FalsePositivesRouter = require('./routes/FalsePositives.js');
const BlocklistsRouter = require('./routes/Blocklists/Index.js');
const StatsRouter = require('./routes/Stats.js');
const DeprecatedListsRouter = require('./routes/Blocklists/Deprecated.js');

app.use(updateStats);

// Routes
app.use(IndexRouter);
app.use(FalsePositivesRouter);
app.use(DeprecatedListsRouter);
app.use(BlocklistsRouter);
app.use(StatsRouter);


// Error handling
app.use(notFound);
app.use(internalError);

// Start the server
const { DOMAIN, PORT } = process.env;
app.listen(PORT, () => process.send ? process.send('ready') : console.log(`Server running at ${DOMAIN}:${PORT}`));