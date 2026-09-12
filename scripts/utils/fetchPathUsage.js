const axios = require('../../www/services/axios.js');

const HOST = 'blocklist.sefinek.net';

module.exports = async (paths, { token, zoneId, hours = 24 }) => {
	if (!paths.length) return 0;

	const end = new Date();
	const start = new Date(end.getTime() - hours * 60 * 60 * 1000);
	const query = `
		query ($zoneTag: string, $paths: [string!], $start: Time!, $end: Time!) {
			viewer {
				zones(filter: { zoneTag: $zoneTag }) {
					usage: httpRequestsAdaptiveGroups(
						limit: 1
						filter: { datetime_geq: $start, datetime_leq: $end, clientRequestHTTPHost: "${HOST}", clientRequestHTTPMethodName: "GET", clientRequestPath_in: $paths }
					) { count }
				}
			}
		}
	`;

	const res = await axios.post('https://api.cloudflare.com/client/v4/graphql', {
		query,
		variables: { zoneTag: zoneId, paths, start: start.toISOString(), end: end.toISOString() },
	}, { headers: { Authorization: `Bearer ${token}` } });

	if (res.data.errors) throw new Error(`Analytics query failed: ${JSON.stringify(res.data.errors)}`);
	return res.data.data.viewer.zones[0]?.usage[0]?.count ?? 0;
};
