import { describe, it, expect } from 'vitest';
import {
  isAllowedGitPath,
  buildUpstreamGitUrl,
  buildGitAuthHeader,
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
