# `cdn.builderforce.ai`

Public R2 bucket `builderforce-cdn` on a custom domain. **No Worker** is bound
to this hostname — the `*.builderforce.ai/*` sites Worker must not steal it.
`cdn-ensure.sh` creates a Workers route `cdn.builderforce.ai/*` with no script
so the catch-all cannot match.

## Object layout

| Key | Cache-Control | Who fetches it |
| --- | --- | --- |
| `replay/v1/loader.js` | `public, max-age=300` | Customer pages (`<script src=…>`) |
| `replay/r/recorder.<hash>.js` | `public, max-age=31536000, immutable` | Loader, after reading the manifest |
| `replay/manifest.json` | `public, max-age=60` | Loader (browser) **and** `ReplayConfigService` (API, 10 min in-process cache) |
| `embed/v1.js` | `public, max-age=300` | `unifiedEmbedSnippet()` in `frontend/src/lib/embeddedCapabilities.ts:80` |

The loader is 5 minutes so a botched publish heals on the next page load. The
hashed recorder is immutable because its URL is content-addressed. The manifest
is 60 seconds so `ReplayConfigService` and the snippet see a new recorder
within a minute of publish.

## Manifest contract

`GET https://cdn.builderforce.ai/replay/manifest.json` returns both shapes:

```json
{
  "version": 1,
  "hash": "<8 hex>",
  "loader": "/replay/v1/loader.js",
  "recorder": "/replay/r/recorder.<hash>.js",
  "embed": "/embed/v1.js",
  "builtAt": "<ISO-8601>",
  "latest": {
    "version": "<package version>",
    "url": "https://cdn.builderforce.ai/replay/r/recorder.<hash>.js",
    "hash": "<8 hex>",
    "builtAt": "<ISO-8601>"
  }
}
```

- The snippet / npm loader reads `recorder` + `hash`.
- `ReplayConfigService` reads `latest` (url, hash, version, builtAt) and
  caches the response 10 minutes. The URL is public; CORS is `GET, HEAD`
  from `*` so a browser can fetch it too. Worker-side `fetch` does not
  need CORS.

`api/wrangler.toml` exposes `REPLAY_CDN_ORIGIN` and `REPLAY_MANIFEST_URL`
so the API can point at this file without a hardcoded string.

## `embed/v1.js`

The marketing snippet already points at `https://cdn.builderforce.ai/embed/v1.js`.
S2 publishes the replay-sdk embed IIFE at that path (same `data-builderforce-key`
contract as the loader). It boots session replay and installs
`window.BuilderForce.session`. Hosted-app runtimes (flags, forms) can land
later at the same URL; leaving it 404 is not an option.

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

The job YAML lives at [`publish-cdn.job.yml`](./publish-cdn.job.yml) so it
can be spliced into `.github/workflows/release.yml` after `package-npm`
and before `deploy-api`. S2 does not own that workflow file.

Until the job is spliced, a maintainer publishes with the two scripts
above. The live kill-check (`curl -I` the four URLs) is S8.

## Binding

The API Worker binds the same bucket as `CDN` (`api/wrangler.toml`) so
internal code can read objects without going over the public hostname.
Public traffic still hits `cdn.builderforce.ai` — there is **no**
`[[routes]]` for this host on the API or sites Worker.
