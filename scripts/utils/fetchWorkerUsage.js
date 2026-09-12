const axios = require('../../www/services/axios.js');

// workersZoneInvocationsAdaptiveGroups reflects actual Worker script invocations (what counts
// against the Workers Free daily cap), unlike httpRequestsAdaptiveGroups which counts all zone
// HTTP traffic to a path regardless of whether a Worker route ever matched it.
module.exports = async ({ token, zoneId, hours = 24 }) => {
	const end = new Date();
	const start = new Date(end.getTime() - hours * 60 * 60 * 1000);
	const query = `
		query ($zoneTag: string, $start: Time!, $end: Time!) {
			viewer {
				zones(filter: { zoneTag: $zoneTag }) {
					invocations: workersZoneInvocationsAdaptiveGroups(
						limit: 1
						filter: { datetime_geq: $start, datetime_leq: $end }
					) { sum { requests } }
				}
			}
		}
	`;

	const res = await axios.post('https://api.cloudflare.com/client/v4/graphql', {
		query,
		variables: { zoneTag: zoneId, start: start.toISOString(), end: end.toISOString() },
	}, { headers: { Authorization: `Bearer ${token}` } });

	if (res.data.errors) throw new Error(`Analytics query failed: ${JSON.stringify(res.data.errors)}`);
	return res.data.data.viewer.zones[0]?.invocations[0]?.sum?.requests ?? 0;
};
