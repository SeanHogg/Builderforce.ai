/**
 * The ONE repository identity that may leave the device. Locally a repository is named by its `remote.origin.url`, else its
 * root path (`repositoryIdentityOf`, `runChangeBaseline.ts`). That local name can hold credentials (`https://user:token@host/…`)
 * or a local path (`file://…`, a relative remote, the root itself), so every synced record names the repository through
 * {@link syncedRepositoryIdentity}:
 *
 *   - an `http(s)`, `ssh`, `git`, `git+ssh` or `ssh+git` URL keeps its scheme, host, port and path; its userinfo, query and
 *     fragment are dropped;
 *   - an scp-style remote (`git@host:org/repo.git`) becomes `ssh://host/org/repo.git`;
 *   - anything else (a `file://` URL, an absolute, relative or Windows path) is `local:<16 hex>`: a hash of its POSIX spelling.
 *
 * Idempotent: a value it produced passes through unchanged, so a record read back and synced again names the same repository.
 */

import { createHash } from "node:crypto";

const LOCAL = /^local:[0-9a-f]{16}$/;
/** `scheme://authority/path?query#fragment` for the network schemes a git remote uses. */
const NETWORK_URL = /^(https?|ssh|git|git\+ssh|ssh\+git):\/\/([^/?#]*)([^?#]*)/i;
/** `[user@]host:path` with no slash before the colon (git's own scp-form rule). */
const SCP = /^(?:[^@/\\]+@)?([^@/\\:]+):([^?#]*)/;
const WINDOWS_PATH = /^[A-Za-z]:([\\/]|$)/;

function localIdentity(repo: string): string {
  return `local:${createHash("sha256").update(repo.replace(/\\/g, "/")).digest("hex").slice(0, 16)}`;
}

/** The repository identity as a synced record may carry it (see the module rule). */
export function syncedRepositoryIdentity(repo: string): string {
  if (LOCAL.test(repo)) return repo;
  const url = NETWORK_URL.exec(repo);
  if (url) {
    const host = url[2]!.slice(url[2]!.lastIndexOf("@") + 1);
    return host ? `${url[1]!.toLowerCase()}://${host}${url[3]}` : localIdentity(repo);
  }
  if (!WINDOWS_PATH.test(repo) && !repo.includes("://")) {
    const scp = SCP.exec(repo);
    if (scp && scp[2]) return `ssh://${scp[1]}/${scp[2].replace(/^\/+/, "")}`;
  }
  return localIdentity(repo);
}
