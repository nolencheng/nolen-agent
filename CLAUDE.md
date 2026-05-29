# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start local development server (wrangler dev)
npm run deploy   # Deploy to Cloudflare Workers
```

## Architecture

This is a **Cloudflare Workers Sites** static site. The deployment pattern:

1. Static files (`index.html`, `style.css`, `script.js`) at the project root are uploaded to **Cloudflare KV storage** automatically by Wrangler (configured via `[site]` in `wrangler.toml` with `bucket = "."`).
2. The Worker at `workers-site/index.js` uses `@cloudflare/kv-asset-handler` to serve those KV assets on every request. There is no asset manifest pre-build step — `importManifest()` returns an empty object and Wrangler handles manifest injection at deploy time.
3. Any unmatched path returns a plain `"Not Found"` string response.

The frontend is vanilla HTML/CSS/JS — no bundler, no framework, no TypeScript. Content is in Simplified Chinese.

## Key Files

- `wrangler.toml` — Worker name (`nolen-agent`), compatibility date, and `[site]` bucket config
- `workers-site/index.js` — sole Worker entry point; do not rename without updating `wrangler.toml`
- `index.html`, `style.css`, `script.js` — all static assets served from KV
