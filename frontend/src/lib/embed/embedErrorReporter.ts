/**
 * Early, framed-only crash reporter for the `/embed/*` surface.
 *
 * The framed embed pages run inside a `credentialless`, cross-origin iframe (the
 * BuilderForce VS Code extension webview, or a third-party host). When the page
 * throws during render/hydration there, the exception is trapped in the
 * cross-origin iframe console the host can't read — the host only observes "no
 * `ready` within 15s" and shows a blank panel. This raw inline script — emitted
 * in the ROOT layout's <head> so it truly runs BEFORE the route bundle evaluates
 * (a nested layout's `<Script strategy="beforeInteractive">` is ignored by
 * Next.js — only the root layout honours it) — installs `window.onerror` +
 * `unhandledrejection` handlers that, WHEN FRAMED (`window !== window.parent`),
 * postMessage `{ source, type:'error', message }` to the parent. The host already
 * logs frame `error` messages (the VS Code "Copy log" panel / BuilderForceEmbed
 * `onError`), so an iframe-internal failure becomes a real, diagnosable error
 * instead of a silent timeout.
 *
 * It no-ops entirely on the top-level app (unframed) — the `window === window.parent`
 * guard returns before adding any listener — so it costs nothing on normal pages.
 *
 * The protocol source token is inlined as a raw string literal (the script must
 * predate any bundle, so it can't import the constant). `embedErrorReporter.test.ts`
 * guards it against drift from `BFEMBED_SOURCE`.
 */
export const EMBED_ERROR_REPORTER = `(function(){try{
  if (window === window.parent) return;
  var SRC = 'builderforce-embed/v1';
  var report = function(message){
    try { window.parent.postMessage({ source: SRC, type: 'error', message: String(message).slice(0, 2000) }, '*'); } catch(e){}
  };
  window.addEventListener('error', function(e){
    report((e && e.message) ? e.message : 'window.onerror');
  });
  window.addEventListener('unhandledrejection', function(e){
    var r = e && e.reason;
    report(r ? (r.message || String(r)) : 'unhandledrejection');
  });
}catch(e){}})();`;
