module.exports = async (fn, { maxRetries = 3, baseMs = 500, isRetryable = () => true, onRetry } = {}) => {
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (err) {
			if (attempt === maxRetries || !isRetryable(err)) throw err;
			const delay = Math.round(baseMs * 2 ** (attempt - 1) * (0.75 + Math.random() * 0.5));
			onRetry?.(err, attempt, delay);
			await new Promise(resolve => setTimeout(resolve, delay));
		}
	}
};
