/**
 * Install snippets (PRD 33 §3.4, D5) — the three ways a site adds the loader,
 * written once for the set-up flow, the Verify step, the docs and the npm
 * entry.
 *
 * The loader URL never changes (D5); recorder updates ride the config answer.
 */

/** Public CDN origin (D5). */
export const REPLAY_CDN_ORIGIN = 'https://cdn.builderforce.ai';
/** API origin the loader talks to unless `data-api` overrides it. */
export const REPLAY_API_ORIGIN = 'https://api.builderforce.ai';
/** Stable loader path on the CDN (max-age 300). */
export const REPLAY_LOADER_PATH = '/replay/v1/loader.js';
/** Recorder manifest path on the CDN (max-age 60). */
export const REPLAY_MANIFEST_PATH = '/replay/manifest.json';
/** Unified embed rail path on the CDN (max-age 300). */
export const REPLAY_EMBED_PATH = '/embed/v1.js';
/**
 * Hex characters of a recorder's content hash (`replay/r/recorder.<hash>.js`). The ONE
 * source: `replay-sdk/scripts/emit-assets.mjs` (plain node, cannot import this file)
 * writes that many, and the API accepts a site's `recorderChannel` as a pinned hash
 * only at exactly this length. A replay-sdk test fails if the two drift.
 */
export const RECORDER_HASH_LENGTH = 12;
/** A recorder content hash — what a site's `recorderChannel` holds to pin one build. */
export const RECORDER_HASH_PATTERN = new RegExp(`^[0-9a-f]{${RECORDER_HASH_LENGTH}}$`);
/**
 * The CDN manifest (`REPLAY_MANIFEST_PATH`). `latest` names the hashed
 * recorder the config answer hands the loader; `player` names the hashed
 * rrweb Replayer bundle (global `BuilderforceReplayPlayer`) and its
 * stylesheet, which the Insights player and the MP4 renderer load at runtime.
 */
export interface ReplayManifest {
  latest: { version: string; url: string; hash: string; builtAt: string };
  /** Platform pin (rollback, §3.5): wins over `latest` for sites on no channel. Carried across releases by `cdn-publish.sh`. */
  pinned?: { version?: string; url: string; hash?: string };
  /** Named channels (e.g. `stable`) a site's `recorderChannel` may select. Carried across releases by `cdn-publish.sh`. */
  channels?: Record<string, { version?: string; url: string; hash?: string }>;
  player?: { url: string; cssUrl: string; rrweb: string };
  /** The page-review kit (`deriveSelector` + `applyVisualPatch`) the capture runner injects into the page under review. */
  pageKit?: { url: string };
}

/** The global the player bundle assigns. */
export const REPLAY_PLAYER_GLOBAL = 'BuilderforceReplayPlayer';

/** The global the page-review kit bundle assigns (`replay-sdk/src/pageKit.ts`). */
export const REPLAY_PAGE_KIT_GLOBAL = 'BuilderforcePageKit';

/** The npm package that installs the same loader. */
export const REPLAY_NPM_PACKAGE = '@seanhogg/builderforce-replay';

function trimOrigin(origin: string): string {
  return origin.replace(/\/+$/, '');
}

/** The loader URL on a CDN origin (default `REPLAY_CDN_ORIGIN`). */
export function replayLoaderUrl(cdnOrigin: string = REPLAY_CDN_ORIGIN): string {
  return `${trimOrigin(cdnOrigin)}${REPLAY_LOADER_PATH}`;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeJsString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/</g, '\\u003c').replace(/\n/g, '\\n');
}

export interface ReplaySnippets {
  /** Paste into `<head>`. */
  scriptTag: string;
  /** `npm i @seanhogg/builderforce-replay`, then this. */
  npm: string;
  /** Body of a Google Tag Manager "Custom HTML" tag. */
  gtm: string;
}

export function replaySnippets({ siteKey, cdnOrigin }: { siteKey: string; cdnOrigin?: string }): ReplaySnippets {
  const src = replayLoaderUrl(cdnOrigin);
  const scriptTag = `<script async src="${escapeAttr(src)}" data-site="${escapeAttr(siteKey)}"></script>`;
  const npm = `import { startReplay } from '${REPLAY_NPM_PACKAGE}';\nstartReplay({ site: '${escapeJsString(siteKey)}' });`;
  const gtm = [
    '<script>',
    '(function () {',
    "  var s = document.createElement('script');",
    '  s.async = true;',
    `  s.src = '${escapeJsString(src)}';`,
    `  s.setAttribute('data-site', '${escapeJsString(siteKey)}');`,
    '  (document.head || document.documentElement).appendChild(s);',
    '})();',
    '</script>',
  ].join('\n');
  return { scriptTag, npm, gtm };
}
