/**
 * Lexical reader for TypeScript SOURCE, for plain-node scripts that must AGREE with a
 * constant the app owns but cannot import it.
 *
 * `scripts/*.mjs` runs under bare node with no build step, so a script that needs a
 * value declared in `src/**\/*.ts` has historically re-typed it. That copy is the
 * classic silent drift: nothing fails when the TypeScript changes, the script simply
 * starts answering last release's question. `backfill-byo-usage.mjs` carried exactly
 * such a copy of the provider↔vendor map.
 *
 * Deliberately lexical — no TypeScript compilation, no import of the app — for the
 * same reason `lib/drizzleSchema.mjs` is: these run before anything is built. What it
 * adds over a bare regex is that it skips STRINGS and COMMENTS while brace-matching,
 * so a `{` inside a doc comment or a URL cannot end a block early.
 *
 * Two consumers today ({@link blockAfter} for array/object literals,
 * {@link numericConstant} for a scalar), one reason to change: how TS source is read.
 */

/** Index of the closing quote of the string literal that starts at `i`. */
function endOfString(source, i) {
  const quote = source[i];
  for (let j = i + 1; j < source.length; j++) {
    if (source[j] === '\\') { j++; continue; }
    if (source[j] === quote) return j;
    // An unterminated single/double-quoted literal cannot span a line — bail there
    // rather than swallowing the rest of the file.
    if (quote !== '`' && source[j] === '\n') return j;
  }
  return source.length;
}

/**
 * The balanced `open`…`close` literal that follows `anchor`, INCLUDING its delimiters.
 *
 * `anchor` is matched as a RegExp so the caller can pin the real declaration rather
 * than a mention of the same identifier in a doc comment above it — the difference
 * between reading `PROVIDER_VENDOR_MAP` and reading the paragraph that names it.
 * Scanning starts at the END of the anchor match, so an anchor that consumes the
 * TYPE ANNOTATION (one ending in `[^=]` star, `=`, whitespace) skips the perfectly
 * balanced `{ … }` inside `Record<K, { … }>` that would otherwise be returned
 * instead of the initializer.
 *
 * Throws rather than returning null: a script that silently derived an EMPTY map
 * would report "nothing to do" and look like a clean run.
 */
export function blockAfter(source, anchor, open, close, label) {
  const found = anchor.exec(source);
  if (!found) throw new Error(`tsSource: no declaration matching ${anchor} (${label})`);

  let start = -1;
  let depth = 0;
  for (let i = found.index + found[0].length; i < source.length; i++) {
    const c = source[i];
    if (c === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i);
      if (nl < 0) break;
      i = nl;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end < 0) break;
      i = end + 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { i = endOfString(source, i); continue; }
    if (c === open) {
      if (depth === 0) start = i;
      depth++;
    } else if (c === close) {
      depth--;
      if (depth === 0 && start >= 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`tsSource: unbalanced ${open}${close} after ${anchor} (${label})`);
}

/**
 * A numeric literal constant (`export const X = 1_000;`) as a JS number. Underscore
 * separators are stripped, so the source stays readable on both sides.
 */
export function numericConstant(source, name, label) {
  const found = new RegExp(`\\b(?:export\\s+)?const\\s+${name}\\s*(?::[^=]+)?=\\s*([\\d_]+)`).exec(source);
  if (!found) throw new Error(`tsSource: no numeric constant ${name} (${label})`);
  return Number(found[1].replace(/_/g, ''));
}
