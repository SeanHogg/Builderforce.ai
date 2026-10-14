# `cdn.builderforce.ai`

Public R2 bucket `builderforce-cdn` on a custom domain. **No Worker** is bound
to this hostname — the `*.builderforce.ai/*` sites Worker must not steal it.
`cdn-ensure.sh` creates a Workers route `cdn.builderforce.ai/*` with no script
so the catch-all cannot match.

## Object layout

| Key | Cache-Control | Who fetches it |
| --- | --- | --- |
| `replay/v1/loader.js` | `public, max-age=300` | Customer pages (`<script src=…>`) |
| `replay/r/recorder.<hash>.js` | `public, max-age=31536000, immutable` | Loader, at the URL the config answer names |
| `replay/manifest.json` | `public, max-age=60` | `ReplayConfigService` only (API, 10 min in-process cache) |
| `embed/v1.js` | `public, max-age=300` | `unifiedEmbedSnippet()` in `frontend/src/lib/embeddedCapabilities.ts:80` |

The loader is 5 minutes so a botched publish heals on the next page load. The
hashed recorder is immutable because its URL is content-addressed. The manifest
is 60 seconds so `ReplayConfigService` sees a new recorder within a minute of
publish (plus its own 10 min cache).

## Manifest contract

`GET https://cdn.builderforce.ai/replay/manifest.json`:

```json
{
  "latest": {
    "version": "<package version>",
    "url": "https://cdn.builderforce.ai/replay/r/recorder.<12 hex>.js",
    "hash": "<12 hex>",
    "builtAt": "<ISO-8601>"
  }
}
```

Only `ReplayConfigService` reads it (10 min in-process cache) and names the
recorder in the config answer the loader fetches — the loader itself never
reads the manifest, so its URL never changes (PRD 33 §3.5). A rollback is a
pin in the site's `recorderChannel` or the platform setting. CORS is
`GET, HEAD` from `*`; Worker-side `fetch` does not need it.

`api/wrangler.toml` exposes `REPLAY_CDN_ORIGIN` and `REPLAY_MANIFEST_URL`
so the API can point at this file without a hardcoded string.

## `embed/v1.js`

The unified embed snippet (`unifiedEmbedSnippet()`) points at
`https://cdn.builderforce.ai/embed/v1.js`. Its replay part is the loader:
when the tag carries `data-site` (a replay site key) it boots session replay
exactly as `/replay/v1/loader.js` does. The workspace key on
`data-builderforce-key` is never used as a replay key.

## Scripts

```
# Print the wrangler / API calls; no credentials required.
bash .github/scripts/cdn-ensure.sh --dry-run
bash .github/scripts/cdn-publish.sh replay-sdk/dist/assets --dry-run

# Live (needs CLOUDFLARE_API_TOKEN with R2 edit + Zone DNS edit +
# Workers Routes edit, plus CLOUDFLARE_ACCOUNT_ID).
CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… \
  bash .github/scripts/cdn-ensure.sh
npm --prefix replay-sdk run build
CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… \
  bash .github/scripts/cdn-publish.sh replay-sdk/dist/assets
```

`--dry-run` and `DRY_RUN=1` are equivalent. `cdn-ensure.sh` is idempotent:
creating a bucket / domain / route that already exists is success. A 403
names the missing grant.

`cdn-publish.sh` uploads hashed `/replay/r/*` first and `manifest.json`
last, so a new manifest never points at a recorder that is not yet public.
Default source directory is `replay-sdk/dist/assets` (emitted by
`replay-sdk` `npm run build`).

CORS policy lives at `infra/cdn/cors.json` (`GET`, `HEAD` from `*`).

## Release job

`.github/workflows/release.yml` runs `publish-cdn` after `package-npm` (which
also publishes `@seanhogg/builderforce-replay` to npm): it type-checks, tests,
builds and size-checks `replay-sdk`, runs `cdn-ensure.sh`, then
`cdn-publish.sh replay-sdk/dist/assets`. `deploy-api` waits for it but is not
blocked by a CDN failure, because the API reads the live manifest. The live
kill-check (`curl -I` the four URLs) is the runbook's step 1 (PRD 33 §11).

## Binding

The API Worker binds the same bucket as `CDN` (`api/wrangler.toml`) so
internal code can read objects without going over the public hostname.
Public traffic still hits `cdn.builderforce.ai` — there is **no**
`[[routes]]` for this host on the API or sites Worker.
