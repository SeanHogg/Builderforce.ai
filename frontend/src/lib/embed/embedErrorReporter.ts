/**
 * Early, framed-only crash/boot reporter for the `/embed/*` surface.
 *
 * The framed embed pages run inside a `credentialless`, cross-origin iframe (the
 * BuilderForce VS Code extension webview, or a third-party host). When the page
 * fails to render there, the exception is trapped in the cross-origin iframe
 * console the host can't read — the host only observes "no `ready` within 15s"
 * and shows a blank panel. This raw inline script — emitted in the ROOT layout's
 * <head> so it truly runs BEFORE the route bundle evaluates (a nested layout's
 * `<Script strategy="beforeInteractive">` is ignored by Next.js — only the root
 * layout honours it) — turns that silent timeout into a diagnosable signal by
 * postMessaging to the parent (WHEN FRAMED, `window !== window.parent`):
 *
 *   - `boot`  — fired the instant this inline script runs, BEFORE any bundle.
 *               If the host log never shows a `boot` frame message, inline JS is
 *               not executing in the frame AT ALL (a fundamental webview /
 *               credentialless block) — a different failure than a bundle that
 *               loads-and-throws, and the two demand different fixes.
 *   - `error` — a script execution throw (`window.onerror` / unhandledrejection)
 *               OR, via the CAPTURE phase, a subresource LOAD failure (a JS chunk
 *               that 404s or is blocked). Resource-load errors do NOT bubble to
 *               `window`, so a plain (bubble-phase) listener misses them — which
 *               is exactly why a blocked chunk read as a silent timeout before.
 *   - a one-shot `error` "boot-stall" — if the bundle ran but React never posted
 *               `ready` within 9s (e.g. a provider Suspends forever), report the
 *               stall + diagnostics. Gated on `window.__bfEmbedReady` (set by
 *               useEmbedFrame when it posts `ready`) so it never fires over a
 *               page that actually booted.
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
  var send = function(type, message){
    try { window.parent.postMessage({ source: SRC, type: type, message: message == null ? undefined : String(message).slice(0, 2000) }, '*'); } catch(e){}
  };
  send('boot', 'reporter alive; readyState=' + document.readyState);
  window.addEventListener('error', function(e){
    var tgt = e && e.target;
    if (tgt && tgt !== window && (tgt.src || tgt.href)) send('error', 'resource failed to load: ' + (tgt.src || tgt.href));
    else send('error', (e && e.message) ? e.message : 'window.onerror');
  }, true);
  window.addEventListener('unhandledrejection', function(e){
    var r = e && e.reason;
    send('error', r ? (r.message || String(r)) : 'unhandledrejection');
  });
  var t0 = Date.now();
  (function tick(){
    if (window.__bfEmbedReady) return;
    if (Date.now() - t0 > 9000) {
      send('error', 'boot-stall: no ready after 9s; readyState=' + document.readyState +
        ' bodyChildren=' + (document.body ? document.body.childElementCount : -1) +
        ' scripts=' + document.scripts.length);
      return;
    }
    setTimeout(tick, 1500);
  })();
}catch(e){}})();`;
