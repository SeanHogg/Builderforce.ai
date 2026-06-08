import { describe, it, expect } from 'vitest';
import { buildRepoProbeUrl, buildRepoDiagnostic } from './repoDiagnostic';

describe('buildRepoProbeUrl', () => {
  it('builds the github.com REST URL', () => {
    expect(buildRepoProbeUrl({ provider: 'github', owner: 'acme', repo: 'app' }))
      .toBe('https://api.github.com/repos/acme/app');
  });

  it('builds a GitHub Enterprise URL from host', () => {
    expect(buildRepoProbeUrl({ provider: 'github', host: 'ghe.corp.local', owner: 'acme', repo: 'app' }))
      .toBe('https://ghe.corp.local/api/v3/repos/acme/app');
  });

  it('url-encodes the GitLab project path', () => {
    expect(buildRepoProbeUrl({ provider: 'gitlab', owner: 'acme', repo: 'app' }))
      .toBe('https://gitlab.com/api/v4/projects/acme%2Fapp');
  });

  it('builds the Bitbucket URL', () => {
    expect(buildRepoProbeUrl({ provider: 'bitbucket', owner: 'acme', repo: 'app' }))
      .toBe('https://api.bitbucket.org/2.0/repositories/acme/app');
  });
});

describe('buildRepoDiagnostic', () => {
  const repo = { provider: 'github', owner: 'acme', repo: 'app', defaultBranch: 'main', credentialId: 'c1' };

  it('flags a provider mismatch and never includes a token', () => {
    const d = buildRepoDiagnostic(repo, { name: 'My GitLab key', provider: 'gitlab', baseUrl: null }, { ok: false, message: '404' });
    expect(d.credential).toEqual({ linked: true, name: 'My GitLab key', provider: 'gitlab', providerMatchesRepo: false, baseUrl: null });
    expect(d.probeUrl).toBe('https://api.github.com/repos/acme/app');
    expect(d.lastTest).toEqual({ ok: false, message: '404' });
    expect(JSON.stringify(d)).not.toMatch(/token|ghp_|secret/i);
  });

  it('reports an unlinked credential', () => {
    const d = buildRepoDiagnostic({ ...repo, credentialId: null }, null, null);
    expect(d.credential).toEqual({ linked: false });
    expect(d.host).toBe('github.com');
  });
});
