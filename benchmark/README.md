# Benchmark
Measures download speed of blocklist files from `blocklist.sefinek.net`.

## Usage
```bash
node benchmark/speedtest.js before-worker
# ... wrangler deploy ...
node benchmark/speedtest.js after-worker

node benchmark/compare.js before-worker after-worker
```

Options: `--runs=10` (default 5 requests per URL), `--host=https://other-host` (default production).

Results go to `benchmark/results/` (gitignored): a full JSON per run, plus a rolling `summary.csv` used by `compare.js`.

The set of tested files (small/medium/large) lives in `urls.js`.
