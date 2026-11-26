/**
 * The ONE `git` wrapper the repo scripts share (install-git-hooks, check-tests-unchanged, pre-push-check).
 *
 * Runs `git <args>` without a shell and returns stdout. Throws on a non-zero exit (the error carries `.status`).
 *   cwd        working directory (default: the caller's)
 *   trim       trim the output (default false)
 *   stderr     'pipe' (default) or 'ignore'
 *   maxBuffer  stdout ceiling in bytes (default 64 MB)
 *   timeout    ms before git is killed and the call throws (default 20 s); check-tests-unchanged's long reads fit well within it
 */
import { execFileSync } from 'node:child_process';

export function git(args, { cwd, trim = false, stderr = 'pipe', maxBuffer = 64 * 1024 * 1024, timeout = 20000 } = {}) {
  const out = execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', stderr], maxBuffer, timeout });
  return trim ? out.trim() : out;
}
