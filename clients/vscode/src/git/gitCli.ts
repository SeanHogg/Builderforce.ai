/**
 * The `git` CLI runner — the fallback `gitApi.ts` uses on hosts without the Git extension, and the runner the publish
 * gate (`publishGate.ts`) reads diffs with. No `vscode` import, so a module that only needs the CLI (and its tests) can
 * load it; `gitApi.ts` re-exports both functions so its importers are unchanged.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/**
 * Run a git command in `cwd` and return its trimmed stdout; undefined when git is
 * missing or the command failed. `core.quotepath=false` keeps non-ASCII paths
 * readable (no octal escapes) for every caller that parses output.
 *
 * The fallback path for hosts without the Git extension — shared so the two
 * consumers cannot disagree about timeout, quoting or failure handling.
 */
export async function runGit(cwd: string, args: string): Promise<string | undefined> {
  const out = (await runGitRaw(cwd, args))?.trim();
  return out || undefined;
}

/**
 * {@link runGit}, UNTRIMMED and with empty output kept distinct from failure (`""` vs
 * `undefined`) — for callers that parse whitespace-significant output (a diff's last
 * context row is a lone space) or must tell "nothing to show" from "git refused".
 * Larger output and a longer timeout are the caller's to ask for.
 */
export async function runGitRaw(
  cwd: string,
  args: string,
  limits: { timeoutMs?: number; maxBuffer?: number } = {},
): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync(`git --no-optional-locks -c core.quotepath=false ${args}`, {
      cwd,
      timeout: limits.timeoutMs ?? 5_000,
      windowsHide: true,
      maxBuffer: limits.maxBuffer ?? 8 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return undefined;
  }
}
