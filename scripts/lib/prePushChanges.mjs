/**
 * What a push changes: the pushed refs git hands the pre-push hook on stdin, and the files between the base and HEAD.
 */
import { git } from './git.mjs';

const ZERO_SHA = /^0+$/;

/** `<local ref> <local sha> <remote ref> <remote sha>` lines, as git writes them to a pre-push hook's stdin. */
export function parsePushedRefs(stdin) {
  return stdin.split('\n').map((line) => line.trim().split(/\s+/)).filter((p) => p.length >= 4)
    .map(([localRef, localSha, remoteRef, remoteSha]) => ({ localRef, localSha, remoteRef, remoteSha }));
}

/**
 * Whether the working tree can verify this push. The check runs when ANY pushed branch is the checked-out HEAD (the other
 * refs are named in a warning). A push with no stdin lines (a by-hand run) is checked.
 * @returns {{ skip?: string, warnings: string[] }}
 */
export function pushDecision(refs, headSha) {
  if (refs.length === 0) return { warnings: [] };
  const branches = refs.filter((r) => !ZERO_SHA.test(r.localSha) && !r.remoteRef.startsWith('refs/tags/') && !r.localRef.startsWith('refs/tags/'));
  if (branches.length === 0) return { skip: refs.every((r) => ZERO_SHA.test(r.localSha)) ? 'the push only deletes refs' : 'the push only deletes refs or carries tags', warnings: [] };
  const checked = branches.filter((r) => r.localSha === headSha);
  if (checked.length === 0) return { skip: `${branches[0].localRef} (${branches[0].localSha.slice(0, 9)}) is not the checked-out HEAD (${headSha.slice(0, 9)}); the working tree cannot verify another commit`, warnings: [] };
  const others = branches.length - checked.length;
  return { warnings: others ? [`${others} other pushed ref(s) are not the checked-out HEAD and were not checked`] : [] };
}

/** Tracked files with uncommitted changes, and untracked files, from ONE `git status` (a hook run checks the working tree). */
export function workingTreeState(root) {
  const entries = git(['status', '--porcelain=v2', '-z', '--untracked-files=all'], { cwd: root }).split('\0');
  const tracked = [];
  const untracked = [];
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    if (e.startsWith('1 ')) tracked.push(e.split(' ').slice(8).join(' '));
    else if (e.startsWith('2 ')) { tracked.push(e.split(' ').slice(9).join(' ')); i += 1; }
    else if (e.startsWith('u ')) tracked.push(e.split(' ').slice(10).join(' '));
    else if (e.startsWith('? ')) untracked.push(e.slice(2));
  }
  return { tracked, untracked };
}

/**
 * Files changed since the merge base with `baseRef`: commits, plus (by hand) uncommitted and untracked edits.
 * Throws when the base cannot be read; the message names the ref.
 * @returns {{ files: string[], mergeBase: string }}
 */
export function changedFiles(root, baseRef, { includeWorkingTree }) {
  let mergeBase;
  try {
    mergeBase = git(['merge-base', baseRef, 'HEAD'], { cwd: root, trim: true, stderr: 'ignore' });
  } catch {
    throw new Error(`base "${baseRef}" is unreadable (no such ref, or no common ancestor with HEAD)`);
  }
  const files = new Set(git(['diff', '--name-only', '--no-renames', '-z', mergeBase, ...(includeWorkingTree ? [] : ['HEAD'])], { cwd: root }).split('\0').filter(Boolean));
  if (includeWorkingTree) git(['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root }).split('\0').filter(Boolean).forEach((f) => files.add(f));
  return { files: [...files], mergeBase };
}

export const commitsAhead = (root, baseRef) => {
  try { return git(['rev-list', '--count', `${baseRef}..HEAD`], { cwd: root, trim: true, stderr: 'ignore' }); } catch { return '?'; }
};
