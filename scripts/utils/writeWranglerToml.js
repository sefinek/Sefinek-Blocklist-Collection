const { writeFile } = require('node:fs/promises');
const { join } = require('node:path');

const HOST = 'blocklist.sefinek.net';
const ZONE_NAME = 'sefinek.net';
const WRANGLER_TOML_PATH = join(__dirname, '..', '..', 'cloudflare', 'wrangler.toml');

module.exports = async paths => {
	const routes = paths.map(p => `  { pattern = "${HOST}${p}", zone_name = "${ZONE_NAME}" },`).join('\n');
	await writeFile(WRANGLER_TOML_PATH, `name = "sefinek-blocklist-edge-cache"
main = "worker.js"
compatibility_date = "2026-01-01"

routes = [
${routes}
]
`);
};
