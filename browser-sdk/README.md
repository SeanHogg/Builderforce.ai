# @seanhogg/builderforce-quality

Embeddable error-capture SDK for the **Builderforce.ai Product Quality** pillar.
Capture browser and Node errors and ship them to your keyed ingest endpoint in
the canonical format — they appear, grouped by fingerprint, in your Quality
dashboard, ready for a one-click agent fix.

Create a source under **Quality → Sources** in Builderforce to mint an ingest key
(`bfq_…`) and get your endpoint.

## Browser (script tag)

```html
<script src="https://unpkg.com/@seanhogg/builderforce-quality"></script>
<script>
  BuilderforceQuality.init({
    key: 'bfq_xxx',
    endpoint: 'https://api.builderforce.ai/api/quality-ingest',
    release: '1.4.0',
    environment: 'production',
  });
</script>
```

`window.onerror` and `unhandledrejection` are captured automatically. Capture
manually with `BuilderforceQuality.captureException(err)` /
`captureMessage('…')`.

## Browser / app (bundler)

```ts
import { init, captureException } from '@seanhogg/builderforce-quality';

init({ key: 'bfq_xxx', endpoint: 'https://api.builderforce.ai/api/quality-ingest' });

try { risky(); } catch (e) { captureException(e, { tags: { area: 'checkout' } }); }
```

## Server / compiled code

```ts
import { createServerCapture } from '@seanhogg/builderforce-quality/server';

const quality = createServerCapture({
  key: 'bfq_xxx',
  endpoint: 'https://api.builderforce.ai/api/quality-ingest',
  environment: 'production',
});

try { await work(); } catch (e) { await quality.captureException(e); }
```

## Other sources

Any source works: point an **OpenTelemetry** OTLP/HTTP exporter at
`<endpoint>/otlp` (it appends `/v1/logs` and `/v1/traces`), or configure a
**Sentry / PostHog / LogRocket** webhook against the source's webhook URL — the
server translates each into the same canonical format.

MIT © Sean Hogg
