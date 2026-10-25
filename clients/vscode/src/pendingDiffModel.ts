/**
 * The host-free half of the working tree's diff (`detectPendingDiff` in `gitChanges.ts`):
 * which git command to ask, and how to bound what is sent to the webview. Pure, so the
 * Visualization panel's before/after rows are tested without a repository.
 */

/** The prefixes `parseUnifiedDiff` reads. Pinned, because `diff.mnemonicPrefix=true`
 *  in a user's gitconfig writes `c/…` and `w/…` and no row would match a file. */
const DIFF_FLAGS = "--no-color --no-ext-diff --src-prefix=a/ --dst-prefix=b/";

/**
 * The commands that describe every uncommitted change in one repository. With a HEAD,
 * one diff against it covers staged and unstaged work alike. With no commit yet there
 * is no HEAD to diff against: the staged files are the index diff (`--cached`, against
 * the empty tree) and edits made after staging are the worktree diff.
 */
export function pendingDiffCommands(hasHead: boolean): string[] {
  return hasHead ? [`diff HEAD ${DIFF_FLAGS}`] : [`diff --cached ${DIFF_FLAGS}`, `diff ${DIFF_FLAGS}`];
}

/** One file's section may be at most this large; a larger one (a lockfile, a bundle)
 *  is dropped rather than drawn row by row. */
export const MAX_FILE_DIFF_CHARS = 128_000;
/** The whole diff, across repositories: the panel renders every row it is sent. */
export const MAX_PENDING_DIFF_CHARS = 512_000;

/**
 * Bound a unified diff BY FILE: oversized sections are dropped and the rest kept, in
 * order, until the total would pass the cap. Cutting the text instead blanked every
 * row whenever the first file alone was large — one generated file early in the sort
 * order left the whole tree reading "No diff". A dropped file still appears in the
 * tree (the list comes from git status, not from this text); only its rows are absent.
 */
export function boundDiff(
  text: string,
  limits: { perFile?: number; total?: number } = {},
): string {
  const perFile = limits.perFile ?? MAX_FILE_DIFF_CHARS;
  const total = limits.total ?? MAX_PENDING_DIFF_CHARS;
  if (text.length <= total && text.length <= perFile) return text;
  const sections = text.split(/(?=^diff --git )/m);
  let out = "";
  for (const section of sections) {
    if (section.length > perFile) continue;
    if (out.length + section.length > total) break;
    out += section;
  }
  return out;
}
