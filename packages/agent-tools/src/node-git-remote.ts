/**
 * `@builderforce/agent-tools/node-git-remote` — a checkout's git remote, read from its
 * config files with no `git` process: what the knowledge root-id rule (`rootIdFor`,
 * PRD 38 §4.2) keys a repository by on every Node host (the editor, on-prem). Synchronous,
 * because a root id is derived wherever a path is mapped; memoised per folder.
 *
 * Walks up from the folder to the `.git` that owns it (a directory, or a worktree's
 * `gitdir:` file with its `commondir`), and reads `remote "origin"` — else the first
 * remote. Undefined outside a repository or with no remote. Node-only, behind its own
 * export condition (the package root stays builtin-free for the Worker).
 */

import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

const cache = new Map<string, string | undefined>();

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** The git directory holding `config` for the checkout containing `dir`. */
function gitConfigDir(dir: string): string | undefined {
  for (let at = resolve(dir); ; at = dirname(at)) {
    const dotGit = join(at, ".git");
    let isDir = false;
    try {
      isDir = statSync(dotGit).isDirectory();
    } catch {
      const parent = dirname(at);
      if (parent === at) return undefined;
      continue;
    }
    if (isDir) return dotGit;
    const pointer = /^gitdir:\s*(.+)$/m.exec(readText(dotGit) ?? "")?.[1]?.trim();
    if (!pointer) return undefined;
    const gitDir = isAbsolute(pointer) ? pointer : resolve(at, pointer);
    const common = readText(join(gitDir, "commondir"))?.trim();
    return common ? resolve(gitDir, common) : gitDir;
  }
}

/** `[remote "<name>"] url = …` entries, in file order. */
export function remotesOfGitConfig(text: string): Array<{ name: string; url: string }> {
  const out: Array<{ name: string; url: string }> = [];
  let remote: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    const section = /^\s*\[\s*remote\s+"([^"]+)"\s*\]\s*$/.exec(line);
    if (section) { remote = section[1]; continue; }
    if (/^\s*\[/.test(line)) { remote = undefined; continue; }
    const url = remote ? /^\s*url\s*=\s*(.+?)\s*$/.exec(line)?.[1] : undefined;
    if (remote && url) out.push({ name: remote, url });
  }
  return out;
}

/** The checkout's `origin` remote URL (else its first remote); undefined when there is none. */
export function gitOriginUrlSync(dir: string): string | undefined {
  const key = resolve(dir);
  if (cache.has(key)) return cache.get(key);
  const gitDir = gitConfigDir(key);
  const remotes = gitDir ? remotesOfGitConfig(readText(join(gitDir, "config")) ?? "") : [];
  const url = (remotes.find((r) => r.name === "origin") ?? remotes[0])?.url;
  cache.set(key, url);
  return url;
}
