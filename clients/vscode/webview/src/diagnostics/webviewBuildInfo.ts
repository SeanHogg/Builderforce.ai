/**
 * BUILD IDENTITY for the WEBVIEW half of the extension.
 *
 * The host stamps itself in `src/buildInfo.ts`; this is the same fact for the bundle
 * actually rendering the chat. Two stamps rather than one because a report carrying
 * only a version could not answer the question a real failure raised: a run reported an
 * error the guard against it had shipped several versions earlier, and nothing
 * distinguished "the extension host is older than the version it reports" from "the
 * guard has a hole". Both halves travel in one `.vsix`, so in a released install these
 * ids match — and a mismatch is precisely the case that used to be invisible (a
 * `watch:webview` rebuild leaving `out/extension.js` at an older stamp).
 *
 * Injected by the vite `define` in `webview/vite.config.ts`, over the SAME source hash
 * the host uses. Absent outside that bundle (unit tests, tsc), where both read `dev` —
 * itself informative: this capture did not come from a packaged build.
 */

declare const __BF_WEBVIEW_BUILD_ID__: string | undefined;
declare const __BF_WEBVIEW_BUILT_AT__: string | undefined;

/** Value used when the defines are absent (unbundled: tests, `tsc`). */
export const UNSTAMPED_BUILD = 'dev';

function stamped(value: string | undefined): string {
  return typeof value === 'string' && value.length > 0 ? value : UNSTAMPED_BUILD;
}

export const WEBVIEW_BUILD_ID: string = stamped(
  typeof __BF_WEBVIEW_BUILD_ID__ === 'string' ? __BF_WEBVIEW_BUILD_ID__ : undefined,
);

export const WEBVIEW_BUILT_AT: string = stamped(
  typeof __BF_WEBVIEW_BUILT_AT__ === 'string' ? __BF_WEBVIEW_BUILT_AT__ : undefined,
);
