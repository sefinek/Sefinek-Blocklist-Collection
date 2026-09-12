const WebSocket = require('ws');

const { GOODBOT_WS_URL, GOODBOT_WS_SECRET } = process.env;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const REQUEST_TIMEOUT_MS = 5000;
const PING_INTERVAL_MS = 30000;

let ws = null;
let reconnectDelay = RECONNECT_BASE_MS;
let reqCounter = 0;
let pingTimer = null;
const pending = new Map();
let readyWaiters = [];

const connect = () => {
	ws = new WebSocket(GOODBOT_WS_URL, {
		headers: {
			'User-Agent': 'Sefinek-Blocklist-Collection/resolve-good-bots',
			'X-GoodBot-Secret': GOODBOT_WS_SECRET,
		},
	});

	ws.on('open', () => {
		reconnectDelay = RECONNECT_BASE_MS;
		pingTimer = setInterval(() => ws.send(JSON.stringify({ type: 'ping' })), PING_INTERVAL_MS).unref();
		readyWaiters.forEach(({ resolve, timer }) => {
			clearTimeout(timer);
			resolve();
		});
		readyWaiters = [];
	});

	ws.on('message', data => {
		let msg;
		try {
			msg = JSON.parse(data.toString());
		} catch {
			return;
		}

		if (msg.type === 'pong') return;

		const entry = pending.get(msg.reqId);
		if (!entry) return;

		clearTimeout(entry.timer);
		pending.delete(msg.reqId);
		msg.success ? entry.resolve(msg.results) : entry.reject(new Error(msg.error || 'Unexpected response'));
	});

	ws.on('close', () => {
		clearInterval(pingTimer);
		ws = null;
		setTimeout(connect, reconnectDelay).unref();
		reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
	});

	ws.on('error', () => ws?.close());
};

if (GOODBOT_WS_URL && GOODBOT_WS_SECRET) connect();

const whenReady = () => new Promise((resolve, reject) => {
	if (ws?.readyState === WebSocket.OPEN) return resolve();

	const timer = setTimeout(() => {
		readyWaiters = readyWaiters.filter(w => w.resolve !== resolve);
		reject(new Error('good-bot WS connection timed out'));
	}, REQUEST_TIMEOUT_MS);
	readyWaiters.push({ resolve, timer });
});

const checkGoodBotsBulk = async ips => {
	if (!ips.length) return {};
	if (!GOODBOT_WS_URL || !GOODBOT_WS_SECRET) throw new Error('GOODBOT_WS_URL/GOODBOT_WS_SECRET not configured');

	await whenReady();

	return new Promise((resolve, reject) => {
		const reqId = `bulk-${Date.now()}-${reqCounter++}`;
		const timer = setTimeout(() => {
			pending.delete(reqId);
			reject(new Error('good_bots_bulk request timed out'));
		}, REQUEST_TIMEOUT_MS);

		pending.set(reqId, { resolve, reject, timer });
		ws.send(JSON.stringify({ type: 'good_bots_bulk', values: ips, reqId }));
	});
};

module.exports = { checkGoodBotsBulk };
