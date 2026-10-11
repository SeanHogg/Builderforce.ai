# `@seanhogg/builderforce-replay`

Session-replay recorder for Builderforce.ai.

Two ways in, one recorder:

1. **Snippet** — `https://cdn.builderforce.ai/replay/v1/loader.js` with
   `data-builderforce-key`. The loader reads `/replay/manifest.json` and
   injects the hashed recorder.
2. **npm** — `init({ key })` fetches the same manifest and self-updates when
   a newer recorder hash is published; otherwise it runs the bundled build.

```html
<script
  src="https://cdn.builderforce.ai/replay/v1/loader.js"
  data-builderforce-key="SITE_PUBLIC_KEY"
  async
></script>
```

```ts
import { init } from '@seanhogg/builderforce-replay';
await init({ key: 'SITE_PUBLIC_KEY' });
```

`window.BuilderForce.session` is the public API either way:

- `identify(userId, traits?)`
- `setTag(key, value)`
- `track(name, props?)`
- `unmask(selector)` — opt a field out of the default input mask
- `stop()`

Inputs are masked by default (`input`, `textarea`, `[data-bf-mask]`,
password/email/tel, credit-card autocomplete). `[data-bf-unmask]` and
`unmask()` opt out.

Chunks flush every 5 s (`REPLAY_LIMITS.flushIntervalMs`), `sendBeacon` on
hide, retry with backoff on 5xx, split on 413, honour 429 `Retry-After`.
Visitor/visit ids match `VISITOR_ID_PATTERN`; a visit rotates after
`VISIT_IDLE_MS` (30 min).

The same CDN also serves `https://cdn.builderforce.ai/embed/v1.js` (the
`unifiedEmbedSnippet` URL). That file boots this recorder from
`data-builderforce-key` and installs `window.BuilderForce.session`.

`GET /replay/manifest.json` is the contract `ReplayConfigService` reads:

```json
{
  "version": 1,
  "hash": "<8 hex>",
  "loader": "/replay/v1/loader.js",
  "recorder": "/replay/r/recorder.<hash>.js",
  "embed": "/embed/v1.js",
  "builtAt": "<ISO-8601>",
  "latest": {
    "version": "2026.10.0",
    "url": "https://cdn.builderforce.ai/replay/r/recorder.<hash>.js",
    "hash": "<8 hex>",
    "builtAt": "<ISO-8601>"
  }
}
```

`npm run build` writes that layout to `dist/assets/` (and a `dist/cdn/`
alias). `npm run size` asserts gzip budgets after a build: loader ≤ 2 KB,
recorder ≤ 80 KB including rrweb `record`.
