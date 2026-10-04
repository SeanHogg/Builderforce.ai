/**
 * The ONE way a development shim reaches the running preview: injected at the very
 * start of `<head>` in the MOUNTED copy of `index.html`.
 *
 * Three shims ride this — the runtime error reporter (`buildDiagnostics`), the
 * point-and-edit overlay (`visualEditor`) and the review probe (`previewProbe`) — and
 * each used to carry its own copy of the same slice-after-`<head>` arithmetic. They
 * share one contract, so they share one implementation: mounted copy only, never the
 * file on disk and never the publish path; a document with no `<head>` is passed
 * through untouched rather than guessed at.
 *
 * Injected FIRST in `<head>` so the shim is listening before any of the app's own
 * modules evaluate — an error thrown by the first import is the one worth catching.
 */
export function injectIntoHead(files: Record<string, string>, script: string): Record<string, string> {
  const html = files['index.html'];
  if (typeof html !== 'string' || !html.includes('<head')) return files;
  const headEnd = html.indexOf('>', html.indexOf('<head'));
  if (headEnd === -1) return files;
  return {
    ...files,
    'index.html': `${html.slice(0, headEnd + 1)}\n${script}${html.slice(headEnd + 1)}`,
  };
}
