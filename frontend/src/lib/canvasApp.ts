/**
 * The board's code, read as files — what the App surface brings into the session's app.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────
 * Ask Brain for an SMS sender on the board and what lands is `backend/server.js`,
 * `frontend/index.html` and a rendered page — three cards that are one artifact. The App
 * surface runs the session's real project (`canvasSessionApp.ts`), and these cards become
 * its files: silently, on open, every time a card is new or has changed since it was last
 * brought in. So a card Brain writes on the board and a file Brain writes into the
 * workspace end up running in the same app.
 *
 * It is a pure function of the nodes for the same reason `canvasFiles` is: the surface,
 * the importer and a test have to agree about which cards ARE files, and three readers
 * re-deriving that from `data.kind` checks is three places for it to drift.
 *
 * ── WHY ROLES SURVIVE ────────────────────────────────────────────────────────────
 * The surface used to run these cards as one inlined document in an opaque frame, where
 * a server file could only be named, never run. The project runtime CAN run a Node
 * server, so nothing is filtered out by role any more; the role still decides which page
 * is the entry the preview opens.
 */

import { robloxScriptsFrom, slugify } from '@builderforce/creation-canvas-contract';
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

/** A filename from a title with nothing a path segment cannot hold. */
function slugFile(value: string, fallback: string): string {
  return `${slugify(value, { maxLength: 120, fallback })}.html`;
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
        const path = `${slugify(title || node.id, { maxLength: 120, fallback: node.id })}/${script.name}.luau`;
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
