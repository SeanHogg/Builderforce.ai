/**
 * The synced repository identity of a run (PRD 41 `RunFeatures.repository`): the remote URL,
 * else `local:<hash>`, never a local path. The server needs two things from it:
 *
 *   • {@link repositoryIdentityOf} — spell a CLOUD run's repository the way a device spells a
 *     remote, so a cloud row and a device row for the same repo agree;
 *   • {@link parseRepositoryIdentity} — read host / owner / repo back out of either form, so
 *     the label sweep can find the run's pull request in `project_repositories`.
 *
 * Pure.
 */

export interface RepositoryAddress {
  host: string;
  /** Everything between the host and the repo name (a GitLab subgroup path included). */
  owner: string;
  repo: string;
}

/** The host a provider's repositories live on when the row names none. */
const DEFAULT_HOST: Readonly<Record<string, string>> = {
  github: 'github.com',
  gitlab: 'gitlab.com',
  bitbucket: 'bitbucket.org',
};

const stripGit = (path: string): string => path.replace(/\/+$/, '').replace(/\.git$/i, '');

function address(host: string, path: string): RepositoryAddress | null {
  const segments = stripGit(path).split('/').filter((s) => s.length > 0);
  if (!host || segments.length < 2) return null;
  const repo = segments[segments.length - 1]!;
  return { host: host.toLowerCase(), owner: segments.slice(0, -1).join('/'), repo };
}

/**
 * host / owner / repo of a remote-URL identity (`https://`, `ssh://`, scp-style `git@host:o/r`),
 * or null for a `local:` identity or anything unparseable.
 */
export function parseRepositoryIdentity(identity: string): RepositoryAddress | null {
  const value = identity.trim();
  if (value === '' || value.startsWith('local:')) return null;
  const url = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(value);
  if (url) return address(url[1]!, url[2]!);
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(.+)$/.exec(value);
  if (scp) return address(scp[1]!, scp[2]!);
  return null;
}

/** A cloud run's repository identity: `https://<host>/<owner>/<repo>`. */
export function repositoryIdentityOf(repo: { provider: string; host: string | null; owner: string; repo: string }): string {
  const host = (repo.host ?? DEFAULT_HOST[repo.provider] ?? 'github.com').toLowerCase();
  return `https://${host}/${repo.owner}/${repo.repo}`;
}

/** Same repository, compared case-insensitively (hosts and the major providers' names are). */
export function sameRepository(a: RepositoryAddress, b: RepositoryAddress): boolean {
  return a.host.toLowerCase() === b.host.toLowerCase()
    && a.owner.toLowerCase() === b.owner.toLowerCase()
    && stripGit(a.repo).toLowerCase() === stripGit(b.repo).toLowerCase();
}
