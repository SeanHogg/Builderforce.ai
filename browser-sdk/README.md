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

## Canvas preview reporting

A page inside an iframe is opaque to whatever framed it: the embedder cannot read your
`console`, cannot receive your error events and cannot see your failed requests. So a
[Builderforce Creation Canvas](https://builderforce.ai) preview of your site can look
perfectly fine while the page is throwing on every load.

`init()` fixes that for your own pages, on by default and **only when the page is
framed** — an ordinary page pays nothing, not even a listener:

```ts
init({ key: 'bfq_xxx', endpoint: 'https://api.builderforce.ai/api/quality-ingest' });
// framePreview: false to opt out; installCanvasPreviewReporter() to use it on its own.
```

Framed, the page posts each console line, thrown error, subresource that failed to load
and request that failed or returned 4xx/5xx to the framing document, and the canvas shows
them under the preview. Only a level, a truncated line of text and a millisecond offset
are posted — never page content, request bodies or headers, because the document that
framed you may be anyone's.

## Other sources

Any source works: point an **OpenTelemetry** OTLP/HTTP exporter at
`<endpoint>/otlp` (it appends `/v1/logs` and `/v1/traces`), or configure a
**Sentry / PostHog / LogRocket** webhook against the source's webhook URL — the
server translates each into the same canonical format.

MIT © Sean Hogg
