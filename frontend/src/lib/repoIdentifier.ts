/**
 * Parse / validate a source-control repo identifier.
 *
 * The Source-control form has separate `owner` and `repo` boxes; pasting a full
 * URL (or `owner/repo`) into one box was the #1 cause of the GitHub "404" on the
 * repo Test, because the probe builds `/{owner}/{repo}` verbatim. These helpers
 * let the form auto-split a paste and reject a malformed segment with a message
 * that says what each box expects.
 */

export interface ParsedRepoIdentifier {
  owner: string;
  repo: string;
  /** Hostname when the input was a full URL / scp remote (e.g. an enterprise host). */
  host?: string;
}

/** A single owner or repo path segment — letters, digits, dot, underscore, hyphen. */
const SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

export function isValidRepoSegment(value: string): boolean {
  return SEGMENT_RE.test(value.trim());
}

/**
 * Best-effort parse of a pasted repo identifier into owner/repo (+ optional host).
 * Accepts a full URL (`https://github.com/acme/app.git`), an scp remote
 * (`git@github.com:acme/app.git`), or shorthand (`acme/app`). Returns null when
 * the input isn't a recognizable owner/repo pair, so the caller keeps the raw text.
 */
export function parseRepoIdentifier(raw: string): ParsedRepoIdentifier | null {
  const s = raw.trim();
  if (!s) return null;

  // scp-style remote: git@host:owner/repo(.git)
  const scp = /^git@([^:]+):([^/\s]+)\/(.+?)(?:\.git)?\/?$/.exec(s);
  if (scp) return { host: scp[1], owner: scp[2], repo: stripGit(scp[3]) };

  // Full URL: https://host/owner/repo(.git)
  if (/^[a-z]+:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const parts = u.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
      if (parts.length >= 2) return { host: u.hostname, owner: parts[0], repo: stripGit(parts[1]) };
    } catch { /* fall through */ }
    return null;
  }

  // Shorthand: owner/repo
  const parts = s.split('/').filter(Boolean);
  if (parts.length === 2) return { owner: parts[0], repo: stripGit(parts[1]) };

  return null;
}

function stripGit(s: string): string {
  return s.replace(/\.git$/i, '');
}
