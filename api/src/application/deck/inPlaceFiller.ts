/**
 * InPlaceFiller — fill a user-uploaded .pptx template IN PLACE, preserving its
 * design. Unzip with fflate, substitute {{token}} occurrences in every slide's
 * text, re-zip. Runs in the Worker (fflate is fast; only the small slide XML
 * parts are touched — images/media are re-zipped untouched).
 *
 * Two correctness details OOXML forces on us:
 *   1. PowerPoint often splits a typed token across several <a:t> runs. We merge
 *      the <a:t> text within each <a:p> paragraph BEFORE matching, so a token
 *      split as `{{quar` + `ter}}` still resolves.
 *   2. Replacement values are XML-escaped (& < >) so a value like "A & B" can't
 *      corrupt the part.
 *
 * v1 supports text tokens `{{token}}` and table tokens `{{table:name}}` (rendered
 * as newline-joined rows into the holding text cell). Re-dataing NATIVE charts in
 * an uploaded template is V2 (requires editing the embedded xlsx parts).
 */

import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import type { ResolvedBindings } from './types';

const xmlEscape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** token (without braces) → replacement string. Tables become newline-joined text. */
function buildReplacements(resolved: ResolvedBindings): Map<string, string> {
  const map = new Map<string, string>();
  for (const [token, v] of resolved.byToken) {
    if (v.kind === 'text') map.set(token, v.value);
    else if (v.kind === 'table') map.set(token, v.rows.map((r) => r.join('  ·  ')).join('\n'));
    else map.set(token, '');
  }
  return map;
}

/** Replace every {{token}} in `text` using the map; unknown tokens are left as-is. */
function applyTokens(text: string, repl: Map<string, string>): string {
  return text.replace(/\{\{([^{}]+)\}\}/g, (whole, tokenRaw: string) => {
    const token = tokenRaw.trim();
    return repl.has(token) ? xmlEscape(repl.get(token)!) : whole;
  });
}

/**
 * Fill one slide XML part. Merges <a:t> runs per <a:p> paragraph (so split tokens
 * resolve), substitutes, and writes the merged text back into the paragraph's
 * first run (clearing the rest) only when that paragraph actually contained a token.
 */
export function fillSlideXml(xml: string, repl: Map<string, string>): string {
  // Fast path: nothing to do if no tokens appear anywhere in the part.
  if (!xml.includes('{{')) return xml;

  return xml.replace(/<a:p\b[\s\S]*?<\/a:p>/g, (paragraph) => {
    const runRe = /(<a:t[^>]*>)([\s\S]*?)(<\/a:t>)/g;
    const runs: Array<{ open: string; text: string; close: string }> = [];
    let m: RegExpExecArray | null;
    while ((m = runRe.exec(paragraph)) !== null) runs.push({ open: m[1] ?? '', text: m[2] ?? '', close: m[3] ?? '' });
    if (runs.length === 0) return paragraph;

    const merged = runs.map((r) => r.text).join('');
    if (!merged.includes('{{')) return paragraph;

    const replaced = applyTokens(merged, repl);
    if (replaced === merged) return paragraph;

    // Put the whole replaced string into the first run; empty the others.
    let i = 0;
    return paragraph.replace(runRe, (whole, open: string, _text: string, close: string) => {
      const inner = i === 0 ? replaced : '';
      i += 1;
      return `${open}${inner}${close}`;
    });
  });
}

/**
 * Fill a .pptx template in place. Returns the rendered .pptx bytes. Throws if the
 * input is not a valid zip / OpenXML package.
 */
export function fillTemplate(templateBytes: Uint8Array, resolved: ResolvedBindings): Uint8Array {
  const repl = buildReplacements(resolved);
  const files = unzipSync(templateBytes);

  for (const path of Object.keys(files)) {
    // Only touch slide + notes + diagram text parts (where {{tokens}} live).
    const part = files[path];
    if (part && /^ppt\/(slides|notesSlides|diagrams)\/.*\.xml$/.test(path)) {
      const xml = strFromU8(part);
      if (xml.includes('{{')) files[path] = strToU8(fillSlideXml(xml, repl));
    }
  }

  // mtime 0 (deterministic); level 4 keeps re-zip fast for image-heavy decks.
  return zipSync(files, { level: 4 });
}
