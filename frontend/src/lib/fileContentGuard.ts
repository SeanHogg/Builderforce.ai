/**
 * Guard against an agent (or any caller) writing structurally-invalid content
 * into a file — specifically the documented bug where the Brain wrote CSS/JS
 * into `package.json` while it was the active tab, breaking Run with
 * `Invalid package.json: Unexpected token …` [1315].
 *
 * Scope is deliberately narrow: only structural, machine-checkable formats are
 * validated, where a failure is unambiguous. We do NOT attempt fuzzy "this looks
 * like CSS not JS" language-mismatch heuristics — those carry false-positive
 * risk that would block legitimate writes. The checks that ARE unambiguous, each
 * a real cross-wiring seen in a corrupt Designer workspace:
 *   - a `.json` / `.jsonl` file must parse as JSON;
 *   - the INVERSE — a JS/TS source file must NOT be a top-level JSON object/array.
 *     Real ES-module source (`import …`, `export default …`) never parses as
 *     JSON, so a `.js` body that IS strict JSON is the mirror of the [1315] bug:
 *     `package.json`'s content cross-wired into `vite.config.js`, which made Vite
 *     fail with `Expected ";" but found ":"`. A bare string/number/bool is left
 *     alone (those are valid JS expression statements), so only the object/array
 *     shape — which can't be valid top-level JS — is rejected;
 *   - an `.html` file must begin with markup (`<`). When `index.html` gets another
 *     file's JS/config source written into it, the browser serves that source as
 *     plain text — the preview renders the raw `vite.config.js` instead of the app;
 *   - the INVERSE — a JS/TS source file must NOT begin with an HTML document
 *     (`<!doctype html>` / `<html>`), the same cross-wire the other direction.
 *
 * Empty / whitespace-only content is always allowed (creating a blank file).
 */
export type FileContentValidation = { ok: true } | { ok: false; reason: string };

/**
 * Normalize a file body to a string before it is validated/written.
 *
 * Models routinely emit a structured file body — most often `package.json` —
 * as a JSON **object** instead of a string. Passing that straight to anything
 * that expects text crashed the `create_file` tool with `t.trim is not a
 * function` (the minified `content.trim()` in {@link validateFileContentForPath}),
 * which broke every "fix the files" attempt. Serializing the object yields
 * exactly the file the model intended; non-string scalars stringify; null/
 * undefined become an empty file.
 */
export function coerceFileContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content == null) return '';
  if (typeof content === 'object') {
    try {
      return JSON.stringify(content, null, 2);
    } catch {
      return String(content);
    }
  }
  return String(content);
}

/** JS/TS source extensions that must never contain a raw JSON object/array. */
const JS_TS_EXTS = new Set(['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs']);

function extensionOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function validateFileContentForPath(path: string, content: string): FileContentValidation {
  // Defensive: a non-string body (e.g. an object the model emitted) is coerced
  // so this guard can never itself throw `t.trim is not a function`.
  const text = typeof content === 'string' ? content : coerceFileContent(content);
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true };

  const ext = extensionOf(path);

  if (ext === 'json') {
    try {
      JSON.parse(text);
    } catch (e) {
      return { ok: false, reason: `${path} must be valid JSON — refusing to write malformed content (${(e as Error).message}).` };
    }
  }

  // An HTML document must start with markup. Anything else (JS/config source, JSON)
  // means another file's content was written here — the browser then serves it as
  // literal text and the preview shows raw source instead of the app.
  if (ext === 'html' || ext === 'htm') {
    if (trimmed[0] !== '<') {
      return { ok: false, reason: `${path} must be HTML markup (starting with '<') — refusing to write another file's content here.` };
    }
  }

  // Inverse guards for a JS/TS source file: it must be neither JSON data nor an
  // HTML document. Real ES-module source never round-trips through JSON.parse as
  // an object and never begins with an HTML doctype, so neither check can reject
  // legitimate code; a bare JSON scalar (`"x"` / `42` / `true`) is a valid JS
  // expression statement and is left alone.
  if (JS_TS_EXTS.has(ext)) {
    if (/^<!doctype html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
      return { ok: false, reason: `${path} is an HTML document, not ${ext.toUpperCase()} source — refusing to write another file's content here.` };
    }
    try {
      const parsed = JSON.parse(text);
      if (parsed !== null && typeof parsed === 'object') {
        return { ok: false, reason: `${path} looks like JSON data, not ${ext.toUpperCase()} source — refusing to write another file's content here.` };
      }
    } catch {
      /* not JSON → real source → fine */
    }
  }

  if (ext === 'jsonl' || ext === 'ndjson') {
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    for (let i = 0; i < lines.length; i++) {
      try {
        JSON.parse(lines[i] as string);
      } catch {
        return { ok: false, reason: `${path} must be JSON-per-line — line ${i + 1} is not valid JSON.` };
      }
    }
  }

  return { ok: true };
}
