# `@seanhogg/builderforce-replay`

Session replay for Builderforce.ai Insights (PRD 33). One loader, one recorder,
one public API.

## Install

Paste into `<head>`:

```html
<script async src="https://cdn.builderforce.ai/replay/v1/loader.js" data-site="bfr_YOUR_SITE_KEY"></script>
```

or from npm (it injects the same loader, so the recorder updates without a
reinstall):

```ts
import { startReplay } from '@seanhogg/builderforce-replay';
startReplay({ site: 'bfr_YOUR_SITE_KEY' });
```

Optional tag attributes: `data-release` (your release name; otherwise the
recorder fingerprints the page's hashed assets), `data-variant` (A/B label),
`data-api` (API origin override).

## What the loader does

1. Installs a queued `window.BFReplay` stub, so page code never breaks.
2. Stops — before any network call — under Do Not Track or Global Privacy Control.
3. Fetches `https://api.builderforce.ai/api/replay-ingest/v1/config?site=…`
   (no credentials). Stops when the site is disabled.
4. When the site requires consent, waits for `BFReplay.consent(true)`.
5. Injects the recorder the config names (`/replay/r/recorder.<hash>.js`).

## `window.BFReplay`

| Call | Effect |
| --- | --- |
| `consent(granted)` | `false` stops recording and ends the visit |
| `event(name)` | custom event (≤80 chars of `[\w .:-]`) |
| `tag(key, value)` | sticky tag (key ≤64, value ≤200, ≤20 keys); keeps the recording. Values that look like an email or a card number are refused |
| `identify(id, traits?)` | only when the site enables identify; traits are a flat string map (≤20 keys) |
| `keep()` | keep this session's recording |
| `stop()` | stop recording and end the visit |
| `version` | recorder version |

## Privacy

- Every input is masked (`maskAllInputs` is hard-coded on). Password and
  payment-card (`autocomplete="cc-*"`) fields are never captured.
- `data-bf-mask` masks text (all text when the site sets "mask all text");
  `data-bf-block` replaces a region with a placeholder.
- Canvas frames only when the site enables canvas recording (2 fps, JPEG 0.4).

## Recording

Every session sends marks (pages, clicks with grid cells, rage, dead clicks,
quick backs, excessive scrolling, errors, custom events, scroll depth, Core
Web Vitals) so counts are exact. Full recordings are kept for a head sample
(`keepRate`) or when something happens: frustration, an error, a sign-up /
purchase / checkout, a tag or `keep()`. Until then the recorder holds the last
60 s in memory, so a kept recording includes the moments before the trigger.

Chunks go to `/api/replay-ingest/v1/chunks` every 5 s while visible and on
pagehide (`keepalive`), gzip-compressed when the browser supports
`CompressionStream`.

Ids: `bf_visitor_id` / `bf_visit_id` on builderforce.ai (shared with the
product's visitor journey), `bfr_visitor_id` / `bfr_visit_id` elsewhere. A
visit rotates after 30 minutes idle.

## Build

`npm run build` writes the CDN layout to `dist/assets/`:

```
replay/v1/loader.js            loader (≤ 2 KB gzip)
replay/r/recorder.<hash>.js    recorder incl. rrweb (≤ 80 KB gzip), immutable
replay/manifest.json           { "latest": { "version", "url", "hash", "builtAt" } }
embed/v1.js                    unified embed rail (boots replay from data-site)
```

`npm run size` checks the layout and the gzip budgets. The release workflow's
`publish-cdn` job uploads it with `.github/scripts/cdn-publish.sh` (manifest
last); see `infra/cdn/README.md`.
