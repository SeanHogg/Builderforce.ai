/**
 * commitSha — the ONE bound on the git commit a knowledge review states it ran at (`knowledge_scopes.commit_sha`, varchar(64)).
 * A client sends it beside the pack (`?commitSha=` on the sync) or in a write's scope. 7-64 hex: an abbreviation, SHA-1's 40 or
 * SHA-256's 64 (SHA-256 repositories exist). The editor states the same shape (`COMMIT_SHA` in
 * `clients/vscode/src/knowledge/sourcePort.ts`) before it hands a commit to git, so a value that passes here is one it can read;
 * each package asserts the same accept/reject table.
 */
export const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,64}$/i;

/** The sha, lower-cased, when `value` is one; undefined for anything else (a ref expression, an option, too short or long). */
export function commitShaOf(value: unknown): string | undefined {
  return typeof value === 'string' && COMMIT_SHA_PATTERN.test(value) ? value.toLowerCase() : undefined;
}
