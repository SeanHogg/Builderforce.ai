/**
 * Guard against an agent (or any caller) writing structurally-invalid content
 * into a file — specifically the documented bug where the Brain wrote CSS/JS
 * into `package.json` while it was the active tab, breaking Run with
 * `Invalid package.json: Unexpected token …` [1315].
 *
 * Scope is deliberately narrow: only structural, machine-checkable formats are
 * validated, where a failure is unambiguous. We do NOT attempt fuzzy "this looks
 * like CSS not JS" language-mismatch heuristics — those carry false-positive
 * risk that would block legitimate writes. The two checks that ARE unambiguous:
 *   - a `.json` / `.jsonl` file must parse as JSON;
 *   - the INVERSE — a JS/TS source file must NOT be a top-level JSON object/array.
 *     Real ES-module source (`import …`, `export default …`) never parses as
 *     JSON, so a `.js` body that IS strict JSON is the mirror of the [1315] bug:
 *     `package.json`'s content cross-wired into `vite.config.js`, which made Vite
 *     fail with `Expected ";" but found ":"`. A bare string/number/bool is left
 *     alone (those are valid JS expression statements), so only the object/array
 *     shape — which can't be valid top-level JS — is rejected.
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

  // Inverse guard: a JS/TS source file whose entire body is a JSON object/array
  // is corrupt — it's another file's data (almost always package.json) written
  // to a source path. Real source never round-trips through JSON.parse as an
  // object, so this can't reject legitimate code; a bare JSON scalar is skipped
  // because `"x"` / `42` / `true` are valid JS expression statements.
  if (JS_TS_EXTS.has(ext)) {
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
