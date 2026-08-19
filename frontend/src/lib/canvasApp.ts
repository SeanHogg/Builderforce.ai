/**
 * The APP a canvas session is — the projection behind the `app` surface.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────
 * Every other runtime surface is `scope: 'object'`: a résumé is a page, a build is a
 * running frame, an edit is a set of tracks, and each of them is ONE card opened at full
 * size. An application is not shaped like that. Ask Brain for an SMS sender and what
 * lands is `backend/server.js`, `frontend/index.html` and a rendered page — three cards
 * that are one artifact, matching no surface at all, with nothing on the canvas able to
 * run them.
 *
 * So this is the first canvas derivation that reads MANY objects as one thing. It is a
 * pure function of the nodes for the same reason `canvasFiles` is: the surface, a test
 * and (later) a build export all have to agree about what the app IS, and three readers
 * re-deriving that from `data.kind` checks is three places for it to drift.
 *
 * ── WHY A DOCUMENT AND NOT A DEV SERVER ──────────────────────────────────────────
 * `BuilderWorkspace` already has a real WebContainer dev server, and a Builder object
 * bound to a storage project already opens it (`CanvasBuildPanel`). Loose code cards have
 * no project to bind, so the honest thing a browser can run for them is the FRONT END:
 * the entry page with its own stylesheets and scripts inlined, in an opaque-origin frame.
 *
 * That is a real preview, not a mock — and the half it cannot run is not hidden. Server
 * files are separated out by `role`, the instrumentation below reports every call the
 * page makes to a host that is not there, and the surface says so in words. A preview
 * that silently swallowed those calls would be worse than no preview: the user would
 * conclude their Twilio credentials were wrong.
 */

import { robloxScriptsFrom } from '@builderforce/creation-canvas-contract';
import { gameDocumentFromUrl, robloxPlaceFromUrl } from './gameTargets';
import { canvasWebsiteDocument } from './canvasWebsite';

export type CanvasAppFileRole = 'page' | 'style' | 'script' | 'server' | 'config' | 'other';

export interface CanvasAppFile {
  /** The board object this file came from, so the surface can send you back to it. */
  nodeId: string;
  path: string;
  language: string;
  source: string;
  role: CanvasAppFileRole;
}

export interface CanvasApp {
  files: readonly CanvasAppFile[];
  /** The page the preview runs. Null when the session holds no renderable entry. */
  entry: CanvasAppFile | null;
  /** The single document the frame runs, with siblings inlined. Null without an entry. */
  document: string | null;
  /** The files that need a host. A frame cannot run these, and pretending otherwise
   *  is how a working preview convinces somebody their API keys are broken. */
  server: readonly CanvasAppFile[];
}

/**
 * The sandbox the preview frame runs under.
 *
 * `allow-scripts` WITHOUT `allow-same-origin`, which is the same load-bearing rule the
 * game frame follows (`GAME_FRAME_SANDBOX`): granting both lets a frame reach this page's
 * cookies, storage, session token and DOM, and lets it drop its own sandbox — together
 * they are equivalent to no sandbox at all. The capability sets differ because the
 * runtimes differ (a game wants pointer lock; an app wants its form to submit), so this
 * is a second CONTRACT rather than a second copy — and the invariant they share is
 * asserted by a test on each of them rather than by a comment on one.
 *
 * The document goes in through `srcDoc`, never a blob URL: a blob inherits this page's
 * origin and would quietly undo the isolation.
 */
export const CANVAS_APP_FRAME_SANDBOX = 'allow-scripts allow-forms allow-modals';

/** What the frame posts back to the surface. `null` origin — identified by this tag. */
export const CANVAS_APP_MESSAGE = 'builderforce:canvas-app';

export interface CanvasAppLogEntry {
  level: 'log' | 'warn' | 'error' | 'request';
  text: string;
  /** Milliseconds since the frame booted, so the console reads as a run and not a clock. */
  at: number;
}

const PAGE_EXT = /\.html?$/i;
const STYLE_EXT = /\.(css|scss|sass|less)$/i;
const SCRIPT_EXT = /\.(m?js|cjs|jsx|tsx?)$/i;
const CONFIG_EXT = /\.(json|ya?ml|toml|ini|env|example)$/i;

/**
 * What makes a script a SERVER rather than something the page loads.
 *
 * Deliberately about the source and not the folder: `backend/` is a convention Brain
 * usually follows and sometimes does not, and a file called `api.js` sitting at the root
 * is still a server. These four are the things a browser genuinely cannot provide, so a
 * script naming any of them is a script the preview must not pretend to run.
 */
const SERVER_MARKERS = /\brequire\s*\(|\bmodule\.exports\b|\bprocess\.env\b|\.listen\s*\(|\bfrom\s+['"](express|http|fs|path)['"]/;

function roleFor(path: string, source: string): CanvasAppFileRole {
  if (PAGE_EXT.test(path)) return 'page';
  if (STYLE_EXT.test(path)) return 'style';
  if (SCRIPT_EXT.test(path)) return SERVER_MARKERS.test(source) ? 'server' : 'script';
  if (CONFIG_EXT.test(path)) return 'config';
  return 'other';
}

/** The directory part of a path, `''` at the root. */
function dirOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? '' : path.slice(0, cut + 1);
}

/** Resolve `./x`, `../x` and `/x` against a directory, without a URL base. */
function resolvePath(from: string, href: string): string {
  const raw = href.trim().replace(/^\.\//, '');
  if (!raw) return '';
  const base = raw.startsWith('/') ? '' : from;
  const parts: string[] = [];
  for (const segment of `${base}${raw.replace(/^\//, '')}`.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') { parts.pop(); continue; }
    parts.push(segment);
  }
  return parts.join('/');
}

/**
 * The file a page's `href`/`src` means.
 *
 * Resolved properly first, then by basename. The fallback is not sloppiness: cards carry
 * whatever path Brain wrote on them, and `frontend/index.html` asking for `styles.css`
 * when the card is `frontend/css/styles.css` is a mismatch between two model-authored
 * strings, not a decision the author made. Falling back to the basename renders the page
 * the author meant; failing to would show them an unstyled document and no reason why.
 */
function fileFor(files: readonly CanvasAppFile[], fromDir: string, href: string): CanvasAppFile | null {
  if (/^(https?:)?\/\/|^data:/i.test(href.trim())) return null;
  const resolved = resolvePath(fromDir, href);
  const exact = files.find((file) => file.path === resolved);
  if (exact) return exact;
  const base = resolved.slice(resolved.lastIndexOf('/') + 1).toLowerCase();
  if (!base) return null;
  return files.find((file) => file.path.slice(file.path.lastIndexOf('/') + 1).toLowerCase() === base) ?? null;
}

/** A filename from a title with nothing a path segment cannot hold. */
function slugFile(value: string, fallback: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug || fallback}.html`;
}

/**
 * Every file the session's objects hold, as an app would see them.
 *
 * `code` objects are the app's own files: they carry the path, the language and the
 * source Brain wrote. A `website`/`prototype` object is ALSO a file the preview can
 * run — its pages rendered to the same static HTML the site publisher produces — which
 * is what lets a `website` card holding a form and a `code` card holding the handler it
 * posts to open as ONE application instead of a static preview beside an orphan file.
 * A plain `document` stays out: it is prose with no runnable shape.
 *
 * A `game` is in for the same reason a website is, and for one more. A web game IS an
 * HTML document, so the preview runs it and the Code reading shows its source — which is
 * the whole of "play it and code it in the app modality". A Roblox game is not runnable
 * here, but the half of it a person actually edits IS source: the Luau lifted back out of
 * the place. Leaving those out left the app surface reporting "nothing to run" on a board
 * whose only object was a game.
 */
export function canvasAppFiles(
  nodes: ReadonlyArray<{ id: string; data: { [key: string]: unknown; kind: string } }>,
): CanvasAppFile[] {
  const files: CanvasAppFile[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    if (node.data.kind === 'code') {
      // `content` is the field Brain actually authors — it is what `CreationNode`'s own
      // card preview reads first — and `code` is a second, rarer field the same kind
      // accepts (see `MUTABLE_FIELDS.code`). Reading `code` alone silently dropped every
      // Brain-authored file from the app runtime: a session built from a chat turn (the
      // GreenEdge Yard Care repro, 2026-08-16) had six `code` cards, all written to
      // `content`, and the `app` surface reported "nothing to run" despite them.
      const source = typeof node.data.content === 'string' && node.data.content.trim()
        ? node.data.content
        : typeof node.data.code === 'string' ? node.data.code : '';
      if (!source.trim()) continue;
      const declared = typeof node.data.path === 'string' ? node.data.path.trim() : '';
      const language = typeof node.data.language === 'string' ? node.data.language.trim().toLowerCase() : '';
      // A card with no path still holds source. Naming it after the object is what keeps
      // it in the Code reading instead of dropping it silently for want of a filename.
      const title = typeof node.data.title === 'string' ? node.data.title.trim() : '';
      const path = (declared || title || 'untitled').replace(/^\.?\//, '');
      if (seen.has(path)) continue;
      seen.add(path);
      files.push({ nodeId: node.id, path, language, source, role: roleFor(path, source) });
      continue;
    }
    if (node.data.kind === 'game') {
      const title = typeof node.data.title === 'string' ? node.data.title.trim() : '';
      const html = gameDocumentFromUrl(node.data.outputUrl);
      if (html) {
        const path = slugFile(title, node.id);
        if (seen.has(path)) continue;
        seen.add(path);
        files.push({ nodeId: node.id, path, language: 'html', source: html, role: 'page' });
        continue;
      }
      // A place: not runnable in a frame, but its rules are readable and are the
      // thing a person edits. `role: 'other'` keeps it out of the entry search —
      // Luau is not a page, and claiming it as one would break the preview.
      const place = robloxPlaceFromUrl(node.data.outputUrl);
      for (const script of robloxScriptsFrom(place)) {
        const path = `${(title || node.id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || node.id}/${script.name}.luau`;
        if (seen.has(path)) continue;
        seen.add(path);
        files.push({ nodeId: node.id, path, language: 'luau', source: script.source, role: 'other' });
      }
      continue;
    }
    if (node.data.kind === 'website' || node.data.kind === 'prototype') {
      const title = typeof node.data.title === 'string' ? node.data.title.trim() : '';
      // ONE rendering of an authored site, shared with the card and the `site` surface —
      // see `canvasWebsite.ts` for why the board no longer draws a second one of its own.
      const source = canvasWebsiteDocument(node.data);
      if (!source) continue;
      const path = slugFile(title, node.id);
      if (seen.has(path)) continue;
      seen.add(path);
      files.push({ nodeId: node.id, path, language: 'html', source, role: 'page' });
    }
  }
  return files;
}

/**
 * The page the preview opens with — `index.html` if the session has one, otherwise the
 * first page there is. A session with two pages and no index is a site the author has
 * not finished; opening the first one is more useful than refusing to open any.
 */
export function canvasAppEntry(files: readonly CanvasAppFile[]): CanvasAppFile | null {
  const pages = files.filter((file) => file.role === 'page');
  const index = pages.find((file) => /(^|\/)index\.html?$/i.test(file.path));
  return index ?? pages[0] ?? null;
}

/** Escape a source so it cannot terminate the `<script>` element it is inlined into. */
function safeScript(source: string): string {
  return source.replace(/<\/(script)/gi, '<\\/$1');
}

/**
 * Injected FIRST, before any authored code runs, so it patches the two things a preview
 * has to be honest about:
 *
 *   - `console.*`, because a page that fails silently inside an opaque-origin frame is a
 *     page nobody can debug from outside it;
 *   - `fetch`, because the front end will call a backend this frame does not have, and
 *     the browser's own "Failed to fetch" is indistinguishable from a bad credential.
 *
 * It reports through `postMessage` rather than anything that needs same-origin — which
 * is the whole point of the sandbox — and it re-throws nothing it did not already throw.
 */
function instrumentation(): string {
  return `<script>(function(){
  var TAG=${JSON.stringify(CANVAS_APP_MESSAGE)},t0=Date.now();
  function say(level,text){try{parent.postMessage({tag:TAG,level:level,text:String(text).slice(0,500),at:Date.now()-t0},'*');}catch(e){}}
  ['log','warn','error'].forEach(function(level){
    var original=console[level];
    console[level]=function(){try{say(level,Array.prototype.map.call(arguments,function(v){
      return typeof v==='string'?v:(function(){try{return JSON.stringify(v);}catch(e){return String(v);}})();
    }).join(' '));}catch(e){}return original.apply(console,arguments);};
  });
  window.addEventListener('error',function(e){say('error',e.message);});
  window.addEventListener('unhandledrejection',function(e){say('error','Unhandled rejection: '+(e.reason&&e.reason.message||e.reason));});
  var nativeFetch=window.fetch;
  window.fetch=function(input,init){
    var url=typeof input==='string'?input:(input&&input.url)||'';
    var method=(init&&init.method)||(input&&input.method)||'GET';
    say('request',method.toUpperCase()+' '+url);
    return nativeFetch.apply(window,arguments).catch(function(error){
      say('error',method.toUpperCase()+' '+url+' — no host is attached to this preview');
      throw error;
    });
  };
})();</script>`;
}

/**
 * The one document the frame runs.
 *
 * Siblings are INLINED rather than left as relative references because the frame has no
 * origin to resolve them against — a `<link href="styles.css">` inside a `srcDoc` resolves
 * against this app's own URL and 404s, which is how a preview shows a correct page with
 * none of its styling and no explanation.
 */
export function canvasAppDocument(files: readonly CanvasAppFile[], entry: CanvasAppFile | null): string | null {
  if (!entry) return null;
  const dir = dirOf(entry.path);
  let html = entry.source;

  html = html.replace(
    /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi,
    (tag, href: string) => {
      if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) return tag;
      const file = fileFor(files, dir, href);
      return file ? `<style>\n${file.source}\n</style>` : tag;
    },
  );

  html = html.replace(
    /<script\b([^>]*)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi,
    (tag, before: string, src: string, after: string) => {
      const file = fileFor(files, dir, src);
      if (!file) return tag;
      const attrs = `${before} ${after}`.replace(/\s+/g, ' ').trim();
      const type = /\btype\s*=\s*["']module["']/i.test(attrs) ? ' type="module"' : '';
      return `<script${type}>\n${safeScript(file.source)}\n</script>`;
    },
  );

  // A fragment is still a page a person wants to look at. Wrapping it is what lets a
  // card holding only a `<form>` render at all instead of inheriting the frame's defaults.
  if (!/<html[\s>]/i.test(html) && !/<!doctype/i.test(html)) {
    html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>\n${html}\n</body></html>`;
  }

  // First thing in the document, whatever the page's own shape is.
  const head = html.match(/<head[^>]*>/i);
  return head
    ? html.replace(head[0], `${head[0]}${instrumentation()}`)
    : `${instrumentation()}${html}`;
}

/**
 * The session read as one application.
 *
 * Returns an app with an empty file list rather than null when there is nothing to run:
 * the surface has something true to say in that case ("no code on this board yet"), and
 * a null would push that decision back onto every caller.
 */
export function canvasApp(
  nodes: ReadonlyArray<{ id: string; data: { [key: string]: unknown; kind: string } }>,
): CanvasApp {
  const files = canvasAppFiles(nodes);
  const entry = canvasAppEntry(files);
  return {
    files,
    entry,
    document: canvasAppDocument(files, entry),
    server: files.filter((file) => file.role === 'server'),
  };
}

/** Whether the `app` surface has anything to show — read by the switcher and the host. */
export function canvasAppIsRunnable(app: CanvasApp): boolean {
  return app.document !== null;
}
