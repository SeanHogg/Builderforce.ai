/**
 * A commit sha the host will hand to git: 7-64 hex digits (an abbreviation, SHA-1's 40, or SHA-256's 64) and nothing else. Anything
 * git would also accept as a revision (`HEAD~1`, `main`, `a..b`, `@{u}`) is refused, and so is anything starting with `-` — a value
 * like `--output=x` must never reach git's argument list as an option. The API's `COMMIT_SHA_PATTERN`
 * (`api/src/application/knowledge/commitSha.ts`) states the same shape; both packages assert one accept/reject table.
 *
 * Pure and vscode-free on purpose: knowledgeHistory, reviewCommit and sourcePort share it without loading the `vscode` module.
 */
export const COMMIT_SHA = /^[0-9a-f]{7,64}$/i;
