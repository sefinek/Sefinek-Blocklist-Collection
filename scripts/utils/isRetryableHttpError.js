const axios = require('../../www/services/axios.js');

// Retries network-level failures (no response: ETIMEDOUT, ECONNRESET, ENETUNREACH, ...), 429 and 5xx.
// Non-axios errors (e.g. GraphQL errors in a 200 body) are deterministic and never retried.
module.exports = err => {
	if (!axios.isAxiosError(err)) return false;
	const status = err.response?.status;
	return !status || status === 429 || status >= 500;
};
