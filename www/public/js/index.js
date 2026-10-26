import { formatDate, updateElementDate, updateElementDateOnly } from './date.js';

const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_DELAY = 30000;
const HEARTBEAT_INTERVAL = 30000;
const CATEGORY_IDS = ['hosts', 'localhost', 'noip', 'adguard', 'unbound', 'dnsmasq', 'rpz'];

let heartbeatInterval = null, reconnectAttempts = 0, reconnectTimeout = null;
let ws = null;
let lastMessageTime = Date.now();

const statusDot = document.querySelector('.ws-status-dot');
const statusText = document.querySelector('.ws-status-text');

const setStatus = (state, text) => {
	if (statusDot) statusDot.className = `ws-status-dot ${state}`;
	if (statusText) statusText.textContent = text;
};

const elementCache = new Map();

const formatNumber = num => num == null ? '0' : (typeof num === 'number' ? num.toLocaleString('en-US') : String(num));

const getElement = id => {
	if (!elementCache.has(id)) elementCache.set(id, document.getElementById(`stats-content-${id}`));
	return elementCache.get(id);
};

const updateStats = (id, value) => {
	const element = getElement(id);
	if (!element) return;

	const formattedValue = typeof value === 'number' ? formatNumber(value) : String(value);
	if (element.textContent === formattedValue) return;

	element.textContent = formattedValue;
	element.classList.add('stats-updated');
	setTimeout(() => element.classList.remove('stats-updated'), 1000);
};

const handleWebSocketMessage = event => {
	lastMessageTime = Date.now();

	try {
		const data = JSON.parse(event.data);
		if (!data?.stats) return;

		const { stats, uptime, coll } = data;

		if (stats.total != null) updateStats('total-requests', stats.total);
		if (stats.blocklists != null) updateStats('blocklist-requests', stats.blocklists);

		if (stats.categories) {
			CATEGORY_IDS.forEach(id => {
				if (stats.categories[id] != null) updateStats(id, stats.categories[id]);
			});
		}

		if (stats.responses && typeof stats.responses === 'object') {
			Object.entries(stats.responses).filter(([code]) => +code < 500).forEach(([code, count]) => updateStats(`response-${code}`, count));
		}

		if (uptime) updateStats('uptime', uptime);

		if (coll?.createdAt) {
			updateStats('coll-cAt', formatDate(coll.createdAt));
			updateElementDateOnly('stats-since-date', coll.createdAt);
		}

		if (coll?.updatedAt) updateStats('coll-uAt', formatDate(coll.updatedAt));
	} catch (err) {
		console.error('WebSocket message error:', err);
	}
};

const getReconnectDelay = () => Math.min(RECONNECT_DELAY * Math.pow(1.5, reconnectAttempts), MAX_RECONNECT_DELAY);

const connect = () => {
	if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;

	ws = new WebSocket(WS_URL);
	setStatus('connecting', 'Establishing WebSocket connection...');

	ws.onopen = () => {
		reconnectAttempts = 0;
		lastMessageTime = Date.now();
		setStatus('connected', 'Live data, updates every 2 seconds.');

		if (heartbeatInterval) clearInterval(heartbeatInterval);
		heartbeatInterval = setInterval(() => {
			if (Date.now() - lastMessageTime > HEARTBEAT_INTERVAL * 2) ws.close();
		}, HEARTBEAT_INTERVAL);
	};

	ws.onmessage = handleWebSocketMessage;

	ws.onerror = err => console.error('WebSocket error:', err);

	ws.onclose = event => {
		setStatus('disconnected', 'WebSocket disconnected. Data may be outdated.');

		if (heartbeatInterval) {
			clearInterval(heartbeatInterval);
			heartbeatInterval = null;
		}

		if (reconnectTimeout) clearTimeout(reconnectTimeout);
		if (event.code === 4001) return;

		const delay = getReconnectDelay();
		setStatus('reconnecting', `Reconnecting in ${(delay / 1000).toFixed(0)}s...`);
		reconnectTimeout = setTimeout(() => {
			reconnectAttempts++;
			connect();
		}, delay);
	};
};

const initDates = () => {
	updateElementDate('stats-content-coll-cAt');
	updateElementDate('stats-content-coll-uAt');
	updateElementDateOnly('stats-since-date');
};

const init = () => {
	initDates();
	connect();

	window.addEventListener('beforeunload', () => {
		if (reconnectTimeout) clearTimeout(reconnectTimeout);
		if (heartbeatInterval) clearInterval(heartbeatInterval);
		if (ws?.readyState === WebSocket.OPEN) ws.close();
	}, { once: true });
};

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', init);
} else {
	init();
}
