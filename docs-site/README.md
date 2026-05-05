# Builderforce.ai Docs

Astro Starlight site that serves all product documentation under `https://builderforce.ai/docs/*`.

## Local dev

```sh
cd docs-site
npm install
npm run dev   # → http://localhost:4321/docs
```

## Deploy

This is a separate Cloudflare Pages project (`builderforce-docs`) — it builds independently of the Next.js frontend and is mounted under `/docs/*` on the apex domain.

```sh
npm run build           # → dist/
npx wrangler pages deploy dist --project-name=builderforce-docs
```

## Path mounting (one-time CF setup)

The Astro config sets `base: '/docs'` so every emitted URL and asset is prefixed with `/docs/`. Cloudflare must be configured to route `builderforce.ai/docs/*` to this Pages project **without stripping the `/docs/` prefix** — otherwise the worker won't find the requested file.

Two options:

1. **Pages Custom Domain** with the apex `builderforce.ai` and a `/docs/*` route matcher (preferred — native to Pages).
2. **Workers Route**: bind `builderforce.ai/docs/*` to a small worker that proxies to `builderforce-docs.pages.dev` preserving the path.

## Cross-domain redirect (`docs.coderclaw.ai` → `builderforce.ai/docs/*`)

The old domain still has live links across the web. Configure a Cloudflare **Bulk Redirect** at the zone level so every request to `https://docs.coderclaw.ai/<path>` 301s to `https://builderforce.ai/docs/<path>`:

```
Source URL pattern:  https://docs.coderclaw.ai/*
Target URL:          https://builderforce.ai/docs/$1
Status:              301 Moved Permanently
Preserve path/query: yes
```

This is a **manual one-time step** in the Cloudflare dashboard — there is no source-controlled config for zone-level bulk redirects. Once configured, the old `docs.coderclaw.ai` Pages project can be retired.

## In-site short-link redirects

`public/_redirects` contains ~200 short-link redirects (e.g. `/docs/bash` → `/docs/tools/exec`). All paths are `/docs/`-prefixed to match the mount point.
