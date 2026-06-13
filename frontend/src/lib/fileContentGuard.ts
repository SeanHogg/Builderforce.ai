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

function extensionOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

export function validateFileContentForPath(path: string, content: string): FileContentValidation {
  const trimmed = content.trim();
  if (trimmed === '') return { ok: true };

  const ext = extensionOf(path);

  if (ext === 'json') {
    try {
      JSON.parse(content);
    } catch (e) {
      return { ok: false, reason: `${path} must be valid JSON — refusing to write malformed content (${(e as Error).message}).` };
    }
  }

  if (ext === 'jsonl' || ext === 'ndjson') {
    const lines = content.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
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
