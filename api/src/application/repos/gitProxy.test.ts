import { describe, it, expect } from 'vitest';
import {
  isAllowedGitPath,
  buildUpstreamGitUrl,
  buildGitAuthHeader,
  buildGitApiBaseUrl,
  bitbucketServerRepoPath,
  buildBitbucketServerBranchUtilsBase,
  resolveGitApiFlavor,
  parseGitService,
} from './gitProxy';

describe('isAllowedGitPath', () => {
  it('allows the three smart-HTTP endpoints', () => {
    expect(isAllowedGitPath('info/refs')).toBe(true);
    expect(isAllowedGitPath('/git-upload-pack')).toBe(true);
    expect(isAllowedGitPath('git-receive-pack')).toBe(true);
  });
  it('rejects anything else and path traversal', () => {
    expect(isAllowedGitPath('../../etc/passwd')).toBe(false);
    expect(isAllowedGitPath('objects/pack/x')).toBe(false);
    expect(isAllowedGitPath('info/refs/../../x')).toBe(false);
  });
});

describe('buildUpstreamGitUrl', () => {
  it('builds a github URL with default host and query', () => {
    const url = buildUpstreamGitUrl(
      { provider: 'github', host: null, owner: 'acme', repo: 'app' },
      'info/refs',
      'service=git-upload-pack',
    );
    expect(url).toBe('https://github.com/acme/app.git/info/refs?service=git-upload-pack');
  });
  it('uses a self-hosted gitlab host', () => {
    const url = buildUpstreamGitUrl(
      { provider: 'gitlab', host: 'gitlab.acme.io', owner: 'team', repo: 'svc' },
      'git-receive-pack',
    );
    expect(url).toBe('https://gitlab.acme.io/team/svc.git/git-receive-pack');
  });
  it('defaults bitbucket host', () => {
    const url = buildUpstreamGitUrl(
      { provider: 'bitbucket', host: null, owner: 'w', repo: 'r' },
      'git-upload-pack',
    );
    expect(url).toBe('https://bitbucket.org/w/r.git/git-upload-pack');
  });
  it('throws on a disallowed path (no token ever proxied to a junk URL)', () => {
    expect(() => buildUpstreamGitUrl({ provider: 'github', host: null, owner: 'a', repo: 'b' }, '../x'))
      .toThrow(/Disallowed/);
  });
});

describe('buildGitAuthHeader', () => {
  it('uses provider-specific basic-auth usernames', () => {
    expect(buildGitAuthHeader('github', 'tok')).toBe(`Basic ${Buffer.from('x-access-token:tok').toString('base64')}`);
    expect(buildGitAuthHeader('gitlab', 'tok')).toBe(`Basic ${Buffer.from('oauth2:tok').toString('base64')}`);
    expect(buildGitAuthHeader('bitbucket', 'tok')).toBe(`Basic ${Buffer.from('x-token-auth:tok').toString('base64')}`);
  });
});

describe('parseGitService', () => {
  it('extracts the validated service name', () => {
    expect(parseGitService('service=git-upload-pack')).toBe('git-upload-pack');
    expect(parseGitService('a=b&service=git-receive-pack')).toBe('git-receive-pack');
  });
  it('returns null for missing/invalid service', () => {
    expect(parseGitService(null)).toBeNull();
    expect(parseGitService('service=evil')).toBeNull();
  });
});

/**
 * The provider REST base. Bitbucket is the interesting one: Cloud and Server are
 * two incompatible APIs behind one provider string, so the flavor split — and the
 * opt-in that keeps Cloud-shaped callers refusing on a Server host — is pinned here.
 */
describe('resolveGitApiFlavor', () => {
  it('splits Bitbucket Cloud from Bitbucket Server on the host', () => {
    expect(resolveGitApiFlavor('bitbucket', null)).toBe('bitbucket-cloud');
    expect(resolveGitApiFlavor('bitbucket', 'bitbucket.org')).toBe('bitbucket-cloud');
    expect(resolveGitApiFlavor('bitbucket', 'git.acme.internal')).toBe('bitbucket-server');
  });
  it('throws for a provider with no REST mapping at all', () => {
    expect(() => resolveGitApiFlavor('gitea', null)).toThrow();
  });
});

describe('buildGitApiBaseUrl', () => {
  it('maps GitHub cloud + Enterprise and GitLab cloud + self-managed', () => {
    expect(buildGitApiBaseUrl('github', null)).toBe('https://api.github.com');
    expect(buildGitApiBaseUrl('github', 'ghe.acme.com')).toBe('https://ghe.acme.com/api/v3');
    expect(buildGitApiBaseUrl('gitlab', null)).toBe('https://gitlab.com/api/v4');
    expect(buildGitApiBaseUrl('gitlab', 'gl.acme.com')).toBe('https://gl.acme.com/api/v4');
  });

  it('returns the Bitbucket Server 1.0 base ONLY when the caller opts in', () => {
    // Callers that only know Cloud path shapes must keep refusing out loud rather
    // than aiming `/2.0/repositories/...` paths at an API that has never had them.
    expect(() => buildGitApiBaseUrl('bitbucket', 'git.acme.internal')).toThrow(/not supported/);
    expect(buildGitApiBaseUrl('bitbucket', 'git.acme.internal', { allowBitbucketServer: true }))
      .toBe('https://git.acme.internal/rest/api/1.0');
    // The opt-in must not change Cloud.
    expect(buildGitApiBaseUrl('bitbucket', null, { allowBitbucketServer: true }))
      .toBe('https://api.bitbucket.org/2.0');
  });
});

describe('Bitbucket Server addressing', () => {
  it('builds the project/repo path segment', () => {
    expect(bitbucketServerRepoPath('ACME', 'app')).toBe('/projects/ACME/repos/app');
    // Personal repos are `~user` project keys — passed through, not upper-cased.
    expect(bitbucketServerRepoPath('~sean', 'app')).toBe('/projects/~sean/repos/app');
  });
  it('puts branch deletion on the branch-utils plugin API, not /rest/api/1.0', () => {
    expect(buildBitbucketServerBranchUtilsBase('git.acme.internal'))
      .toBe('https://git.acme.internal/rest/branch-utils/1.0');
    expect(() => buildBitbucketServerBranchUtilsBase(null)).toThrow();
  });
});
