module.exports = async (fn, { maxRetries = 3, baseMs = 500, isRetryable = () => true, onRetry } = {}) => {
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (err) {
			if (attempt === maxRetries || !isRetryable(err)) throw err;
			const delay = baseMs * 2 ** attempt;
			onRetry?.(err, attempt, delay);
			await new Promise(resolve => setTimeout(resolve, delay));
		}
	}
};
