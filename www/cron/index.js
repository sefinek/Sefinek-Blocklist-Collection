const cron = require('node-cron');
const { execFile } = require('node:child_process');
const path = require('node:path');
const resolveGoodBots = require('../../scripts/resolve-good-bots.js');

const TIMEZONE = 'Europe/Warsaw';
const SCRIPTS_DIR = path.join(__dirname, '..', '..', 'scripts');

const runScript = name => {
	execFile('node', [path.join(SCRIPTS_DIR, name)], (err, stdout, stderr) => {
		if (stdout?.trim()) console.log(`[cron:${name}]`, stdout.trim());
		if (stderr?.trim()) console.error(`[cron:${name}]`, stderr.trim());
		if (err) console.error(`[cron:${name}] exited with error:`, err.message);
	});
};

const startCronJobs = () => {
	// Every Monday at 03:00 - rebuild the Worker edge-cache route candidate list
	cron.schedule('0 3 * * 1', () => runScript('refresh-worker-routes.js'), { timezone: TIMEZONE, name: 'refresh-worker-routes', noOverlap: true });

	// Every 3 hours - watch Workers Free daily usage, emergency-remove routes if close to the cap
	cron.schedule('0 */3 * * *', () => runScript('worker-usage-watchdog.js'), { timezone: TIMEZONE, name: 'worker-usage-watchdog', noOverlap: true });

	// Every 2 minutes - resolve newly-seen IPs against tcpdata-server's good-bots list in bulk.
	// Runs in-process (not via runScript) to reuse the already-open Redis connection at this frequency.
	cron.schedule('*/2 * * * *', () => resolveGoodBots().catch(err => console.error('[cron:resolve-good-bots]', err.message)), { timezone: TIMEZONE, name: 'resolve-good-bots', noOverlap: true });
};

module.exports = { startCronJobs };
