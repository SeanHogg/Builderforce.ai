/**
 * Guard against an agent (or any caller) writing structurally-invalid content
 * into a file — specifically the documented bug where the Brain wrote CSS/JS
 * into `package.json` while it was the active tab, breaking Run with
 * `Invalid package.json: Unexpected token …` [1315].
 *
 * Scope is deliberately narrow: only structural, machine-checkable formats
 * (JSON / JSONL) are validated, where a parse failure is unambiguous. We do NOT
 * attempt fuzzy "this looks like CSS not JS" language-mismatch heuristics —
 * those carry false-positive risk that would block legitimate writes.
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
