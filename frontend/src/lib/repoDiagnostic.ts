/**
 * Build a copy-pasteable, SECRET-FREE snapshot of a source-control repo binding
 * for diagnosing a failed "Test" (e.g. a GitHub 404). The Copy button on each
 * repo row emits this so a maintainer can see exactly what the probe will hit —
 * the reconstructed probe URL is the single most useful clue for a 404 (wrong
 * owner/repo, wrong host, or a private repo the token can't see).
 *
 * NEVER includes the credential token — only whether a key is linked and its
 * name/provider, so a provider mismatch (e.g. a GitLab key on a GitHub repo) is
 * obvious without leaking anything.
 */

export interface RepoLike {
  provider: string;
  host?: string | null;
  owner: string;
  repo: string;
  defaultBranch?: string | null;
  credentialId?: string | null;
}

export interface CredentialLike {
  name: string;
  provider: string;
  baseUrl?: string | null;
}

/**
 * Reconstruct the exact REST URL the backend probe hits for this repo. Mirrors
 * `probeRepoAccess` in api/.../repoRoutes.ts — keep the two in sync; this is a
 * read-only diagnostic mirror, not a second source of truth for the real call.
 */
export function buildRepoProbeUrl(repo: RepoLike): string {
  const host = repo.host?.trim() || null;
  const { owner, repo: name } = repo;
  switch (repo.provider) {
    case 'github': {
      const apiRoot = !host || host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`;
      return `${apiRoot}/repos/${owner}/${name}`;
    }
    case 'gitlab': {
      const root = host && host !== 'github.com' ? `https://${host}` : 'https://gitlab.com';
      return `${root}/api/v4/projects/${encodeURIComponent(`${owner}/${name}`)}`;
    }
    case 'bitbucket':
      return `https://api.bitbucket.org/2.0/repositories/${owner}/${name}`;
    default:
      return `(no probe URL for provider "${repo.provider}")`;
  }
}

export interface RepoDiagnostic {
  provider: string;
  host: string;
  owner: string;
  repo: string;
  defaultBranch: string | null;
  probeUrl: string;
  credential:
    | { linked: false }
    | { linked: true; name: string; provider: string; providerMatchesRepo: boolean; baseUrl: string | null };
  lastTest: { ok: boolean; message: string } | null;
}

export function buildRepoDiagnostic(
  repo: RepoLike,
  credential: CredentialLike | null,
  lastTest: { ok: boolean; message: string } | null,
): RepoDiagnostic {
  return {
    provider: repo.provider,
    host: repo.host?.trim() || 'github.com',
    owner: repo.owner,
    repo: repo.repo,
    defaultBranch: repo.defaultBranch ?? null,
    probeUrl: buildRepoProbeUrl(repo),
    credential: credential
      ? {
          linked: true,
          name: credential.name,
          provider: credential.provider,
          providerMatchesRepo: credential.provider === repo.provider,
          baseUrl: credential.baseUrl ?? null,
        }
      : { linked: false },
    lastTest: lastTest ?? null,
  };
}

/** Pretty JSON string for the clipboard. */
export function formatRepoDiagnostic(
  repo: RepoLike,
  credential: CredentialLike | null,
  lastTest: { ok: boolean; message: string } | null,
): string {
  return JSON.stringify(buildRepoDiagnostic(repo, credential, lastTest), null, 2);
}
