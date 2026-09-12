const CACHEABLE_EXT = new Set(['.txt', '.conf']);
const EDGE_TTL_SECONDS = 1800;

const getExtension = pathname => {
	const dot = pathname.lastIndexOf('.');
	return dot === -1 ? '' : pathname.slice(dot).toLowerCase();
};

const reportEdgeHit = (origin, path, userAgent, secret) => fetch(`${origin}/api/v1/stats/edge-hit`, {
	method: 'POST',
	headers: {
		'Content-Type': 'application/json',
		'User-Agent': 'Cloudflare-Worker/sefinek-blocklist-edge-cache',
		'X-Edge-Stats-Secret': secret,
	},
	body: JSON.stringify({ path, userAgent }),
}).catch(() => undefined);

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);

		if (request.method !== 'GET' || !CACHEABLE_EXT.has(getExtension(url.pathname)) || request.headers.has('range')) {
			return fetch(request);
		}

		const cache = caches.default;
		const cached = await cache.match(request);
		if (cached) {
			ctx.waitUntil(reportEdgeHit(url.origin, url.pathname, request.headers.get('user-agent'), env.EDGE_STATS_SECRET));
			return cached;
		}

		const response = await fetch(request);
		if (response.ok) {
			const cacheable = new Response(response.body, response);
			cacheable.headers.set('Cache-Control', `public, s-maxage=${EDGE_TTL_SECONDS}`);
			ctx.waitUntil(cache.put(request, cacheable.clone()));
			return cacheable;
		}

		return response;
	},
};
