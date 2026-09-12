const WebSocket = require('ws');

const TIMEOUT_MS = 5000;

module.exports = (ips, { url, secret }) => new Promise((resolve, reject) => {
	if (!ips.length) return resolve({});

	const ws = new WebSocket(url, { headers: { 'X-GoodBot-Secret': secret } });
	const reqId = `bulk-${Date.now()}`;

	const timer = setTimeout(() => {
		ws.terminate();
		reject(new Error('good_bots_bulk request timed out'));
	}, TIMEOUT_MS);

	ws.on('open', () => ws.send(JSON.stringify({ type: 'good_bots_bulk', values: ips, reqId })));

	ws.on('message', data => {
		clearTimeout(timer);
		ws.close();

		let msg;
		try {
			msg = JSON.parse(data.toString());
		} catch (err) {
			return reject(err);
		}

		if (msg.reqId !== reqId || !msg.success) return reject(new Error(msg.error || 'Unexpected response'));
		resolve(msg.results);
	});

	ws.on('error', err => {
		clearTimeout(timer);
		reject(err);
	});
});
