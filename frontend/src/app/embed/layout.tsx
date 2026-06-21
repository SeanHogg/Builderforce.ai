/**
 * Lean layout for the `/embed/*` surface.
 *
 * The embed page renders NO_CHROME (ConditionalAppShell.classifyShell → 'none'),
 * but it is still nested under the root layout's global provider stack
 * (AuthProvider/Emulation/RolePreview/PermissionDebugger/…). When the framed page
 * throws during render/hydration — most visibly inside a VS Code webview or a
 * `credentialless` iframe where one of those providers can fail — the embed just
 * hangs blank and the host (the VS Code extension / a third-party host) can only
 * observe "no `ready` within 15s", with the real exception trapped in the
 * cross-origin iframe console it can't read.
 *
 * This layout injects an EARLY, INLINE `window.onerror` + `unhandledrejection`
 * reporter (in the embed subtree's <head>-equivalent, before the route bundle
 * evaluates) that — when framed (`window !== window.parent`) — postMessages
 *   { source: 'builderforce-embed/v1', type: 'error', message }
 * to the parent. The host already logs frame `error` messages (BuilderForceEmbed
 * `onError` / the VS Code "Copy log" panel), so an iframe-internal failure becomes
 * a real, diagnosable error instead of a silent timeout. The reporter is a raw
 * inline script (not a React effect) so it predates bundle eval and can catch a
 * provider that throws during the very first render pass.
 *
 * Keep this layout intentionally minimal — it adds the reporter and nothing else,
 * so it never introduces its own provider that could fail in the webview context.
 */
import Script from 'next/script';

// The protocol source token, inlined as a literal so the early script has zero
// imports (it must run before any bundle). Mirrors BFEMBED_SOURCE in
// `@seanhogg/builderforce-embedded`'s protocol — kept in sync by the unit test.
const EMBED_REPORTER = `(function(){try{
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

export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* beforeInteractive: emitted ahead of the route bundle so it can catch a
          provider that throws during the first render/hydration pass. */}
      <Script id="bfembed-error-reporter" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: EMBED_REPORTER }} />
      {children}
    </>
  );
}
