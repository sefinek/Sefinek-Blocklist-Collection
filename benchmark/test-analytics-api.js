process.loadEnvFile();
const axios = require('../www/services/axios.js');

const { CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID } = process.env;
if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ZONE_ID) throw new Error('Missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ZONE_ID environment variable');

const now = new Date();
const end = new Date(now.getTime() - 5 * 60 * 1000);
const start = new Date(end.getTime() - 60 * 60 * 1000);

const HOST = 'blocklist.sefinek.net';

const query = `
	query ZoneAnalytics($zoneTag: string, $host: string, $start: Time!, $end: Time!) {
		viewer {
			zones(filter: { zoneTag: $zoneTag }) {
				totals: httpRequestsAdaptiveGroups(
					limit: 1
					filter: { datetime_geq: $start, datetime_leq: $end, clientRequestHTTPHost: $host, clientRequestPath_like: "/generated/v1/%" }
				) {
					count
				}

				totalsSuccessOnly: httpRequestsAdaptiveGroups(
					limit: 1
					filter: { datetime_geq: $start, datetime_leq: $end, clientRequestHTTPHost: $host, clientRequestPath_like: "/generated/v1/%", edgeResponseStatus_geq: 200, edgeResponseStatus_leq: 304 }
				) {
					count
				}

				byCacheStatus: httpRequestsAdaptiveGroups(
					limit: 20
					filter: { datetime_geq: $start, datetime_leq: $end, clientRequestHTTPHost: $host, clientRequestPath_like: "/generated/v1/%" }
				) {
					count
					dimensions {
						cacheStatus
					}
				}

				byPath: httpRequestsAdaptiveGroups(
					limit: 20
					filter: { datetime_geq: $start, datetime_leq: $end, clientRequestHTTPHost: $host, clientRequestPath_like: "/generated/v1/%" }
					orderBy: [count_DESC]
				) {
					count
					dimensions {
						clientRequestPath
						cacheStatus
					}
				}

				freshness: httpRequestsAdaptiveGroups(
					limit: 1
					orderBy: [datetimeMinute_DESC]
					filter: { datetime_geq: $start, clientRequestHTTPHost: $host }
				) {
					dimensions {
						datetimeMinute
					}
				}
			}
		}
	}
`;

(async () => {
	console.log(`Querying window: ${start.toISOString()} -> ${end.toISOString()}\n`);

	const res = await axios.post('https://api.cloudflare.com/client/v4/graphql', {
		query,
		variables: { zoneTag: CLOUDFLARE_ZONE_ID, host: HOST, start: start.toISOString(), end: end.toISOString() },
	}, {
		headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}` },
	});

	if (res.data.errors) {
		console.error('GraphQL errors:', JSON.stringify(res.data.errors, null, 2));
		return;
	}

	const zone = res.data.data.viewer.zones[0];
	if (!zone) return console.error('No zone data returned - check CLOUDFLARE_ZONE_ID / token scope.');

	console.log(`Total /generated/v1/* requests on ${HOST} in window:`, zone.totals[0]?.count ?? 0);
	console.log('Same, but only edgeResponseStatus 200-304:', zone.totalsSuccessOnly[0]?.count ?? 0);
	console.log('\nBy cache status:');
	console.table(zone.byCacheStatus.map(g => ({ cacheStatus: g.dimensions.cacheStatus, count: g.count })));

	console.log('\nBy path (/generated/v1/* only, top 20):');
	console.table(zone.byPath.map(g => ({ path: g.dimensions.clientRequestPath, cacheStatus: g.dimensions.cacheStatus, count: g.count })));

	const freshest = zone.freshness[0]?.dimensions?.datetimeMinute;
	console.log('\nFreshest available data point:', freshest, freshest ? `(${Math.round((now - new Date(freshest)) / 60000)} min ago)` : '(none)');
})().catch(err => {
	console.error('Analytics API test failed:', err.response?.data || err.message);
	process.exit(1);
});
