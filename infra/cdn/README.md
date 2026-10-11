# cdn.builderforce.ai

Public origin for the session-replay loader, the hashed recorder, and the
hosted-app embed. Assets live in the `builderforce-cdn` R2 bucket. The
hostname is a **no-Worker** route — `cdn.builderforce.ai/*` must never hit
the API worker.

## Layout

| URL | Cache | Source |
| --- | --- | --- |
| `/replay/v1/loader.js` | 5 minutes | `replay-sdk` IIFE |
| `/replay/r/recorder.<hash>.js` | 1 year, immutable | hashed recorder (rrweb + marks) |
| `/replay/manifest.json` | 5 minutes | `{ recorder, hash, loader }` |
| `/embed/v1.js` | 5 minutes | hosted-app snippet |

## Snippet

```html
<script
  src="https://cdn.builderforce.ai/replay/v1/loader.js"
  data-builderforce-key="SITE_PUBLIC_KEY"
  async
></script>
```

The loader fetches `/replay/manifest.json` and injects the hashed recorder.
A new recorder is a new URL; the loader does not change.

## Ensure (idempotent)

```bash
# Prints the Cloudflare API calls without executing them.
DRY_RUN=1 bash .github/scripts/cdn-ensure.sh

CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_ZONE_ID=… \
  bash .github/scripts/cdn-ensure.sh
```

Creates the R2 bucket if missing, attaches `cdn.builderforce.ai` as a custom
domain, and posts a workers route `cdn.builderforce.ai/*` with **no script**
so the API worker cannot steal the hostname.

## Publish

```bash
# From repo root, after `npm run build` in replay-sdk.
DRY_RUN=1 bash .github/scripts/cdn-publish.sh
bash .github/scripts/cdn-publish.sh
```

Hashed `/replay/r/*` objects get `Cache-Control: public, max-age=31536000, immutable`.
The loader and the manifest get 5 minutes so a release is visible without a
cache purge.

Release wiring: `.github/workflows/release.yml` job `publish-cdn`, after
`deploy-api`.
