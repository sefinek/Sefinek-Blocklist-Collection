# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DNS blocklist aggregation and distribution platform. Curates domains across categories (ads, malware, phishing, gambling, tracking, etc.), processes them through a cleaning pipeline, generates output in 7+ DNS server formats, and serves them via a Node.js/Express web interface with real-time metrics.

## Commands

```bash
# Linting & validation (runs in CI on list changes)
node scripts/prepare-templates.js   # Merge list categories into templates
node scripts/lint.js                # Validate domain format (lowercase, no whitespace)

# URL testing
npm test                            # scripts/test-urls.js

# Dependency management
npm run m                           # ncu -u && npm i && npm update && npm audit fix

# Branch sync
npm run pull                        # Hard reset main branch from origin
npm run pull:blocklists             # Sync blocklists worktree branch
```

## Architecture

### Two-branch model
- **`main`** - source lists (`lists/`) and processing scripts
- **`blocklists`** - generated output files, mounted as a git worktree at `blocklists/`

### Data flow
1. External blocklists downloaded by `bash/download.sh` (via GH Actions every 3h)
2. `scripts/prepare-templates.js` merges `lists/` categories into `blocklists/templates/`
3. Cleaning pipeline: deduplication, line-ending normalization, lowercase, whitelist applied (`whitelists/main.txt`)
4. `scripts/generate/runner.js` dispatches to format-specific generators in `scripts/generate/formats/` producing 7 output formats (NoIP, 0.0.0.0, 127.0.0.1, AdGuard, DNSmasq, RPZ, Unbound)
5. Generated files committed to `blocklists` branch

### Web server (`www/`)
- **`server.js`** - Express app; in production runs as PM2 cluster (workers per CPU)
- **Primary process** handles MongoDB/Redis connections, stats aggregation (Redis → MongoDB every 5 min), and the cron jobs (`www/cron/index.js`, `node-cron` - only registered here, never in per-CPU workers, to avoid running each job N times)
- **Worker processes** handle HTTP requests
- **`websocket.js`** - Real-time metrics broadcast (max 100 clients, 2s interval)
- Routes: `/`, `/metrics`, `/update-schedule`, `/api/v1/blocklist/check`, `/api/v1/reports/false-positive`, `/api/v1/stats/edge-hit` (internal, called by the Cloudflare Worker), `/docs/`
- Controllers in `www/controllers/`; file listings cached in-memory for 5 hours

### Key infrastructure
- **MongoDB** - request stats, false positive reports
- **Redis** - short-term stats cache
- **PM2** - process management with cluster mode in production (`ecosystem.config.js`)

### Edge cache (`cloudflare/`)
Origin runs in a single region, so the most popular `/generated/v1/*.txt`/`.conf` files are additionally cached at the Cloudflare edge via a Worker (`cloudflare/worker.js`) to speed up downloads for geographically distant users - only a curated subset (`cloudflare/routes.json`) is routed through the Worker, kept under the Workers Free plan's 100k requests/day cap; everything else still goes straight to origin, uncached, exactly as before. Cache HITs served from the edge never reach Express, so the Worker reports them asynchronously to `POST /api/v1/stats/edge-hit` (`www/routes/Stats.js`), which reuses the exact same Redis counters as a normal request (`incrementBlocklistStats` in `www/middleware/other/stats-redis.js`) - metrics stay accurate regardless of where a request was served from. Per-file popularity is tracked in Redis (`stats:filepop:<date>`, 14-day TTL) and used weekly by `scripts/refresh-worker-routes.js` (cron in `www/cron/index.js`) to rebuild the candidate list - it only emails a summary, `wrangler deploy` is manual. `scripts/worker-usage-watchdog.js` (same cron, every 3h) checks real Workers usage and auto-removes the route if it gets close to the daily cap. Blocklist file cache is invalidated by `scripts/purge-cloudflare-cache.js`, run as part of `npm run update`.

## Code Style

ESLint enforced (`eslint.config.mjs`):
- CommonJS modules (`require`/`module.exports`)
- Tabs for indentation, single quotes, semicolons required
- Max 4 nested callbacks

## Environment Variables (`.env`)

```
NODE_ENV=development|production
DOMAIN=http://127.0.0.1
PORT=8080
WS_ADDRESS=ws://127.0.0.1
WS_PORT=8095
MONGODB_URL=mongodb://...
REDIS_HOST=...
REDIS_PASSWD=...
```

## CI/CD Workflows

| Workflow | Trigger | Purpose |
|---|---|---|
| `lint.yml` | Push to `lists/` | Validate domain format |
| `download-blocklists.yml` | Cron `0 */3 * * *` | Download external lists, regenerate all formats |
| `update-blocklists.yml` | Push to `lists/` on main | Process manual list changes, push to blocklists branch |

## List Categories

User-submitted domains in `lists/` are organized by: `ads`, `crypto`, `dating`, `drugs`, `gambling`, `hate-and-junk`, `malicious`, `phishing`, `piracy`, `porn`, `scam`, `suspicious`, `tracking-and-telemetry`, `useless-websites`.

False positives are added to `whitelists/main.txt`; file-specific exceptions are supported.
