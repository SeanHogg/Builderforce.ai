import { describe, expect, it } from 'vitest';
import { parseRepositoryIdentity, repositoryIdentityOf, sameRepository } from './repositoryIdentity';

describe('repository identity', () => {
  it('parses https, ssh and scp-style remotes alike', () => {
    const want = { host: 'github.com', owner: 'acme', repo: 'app' };
    expect(parseRepositoryIdentity('https://github.com/acme/app.git')).toEqual(want);
    expect(parseRepositoryIdentity('ssh://git@github.com:22/acme/app')).toEqual(want);
    expect(parseRepositoryIdentity('git@github.com:acme/app.git')).toEqual(want);
  });

  it('keeps a GitLab subgroup path as the owner', () => {
    expect(parseRepositoryIdentity('https://gitlab.com/group/sub/app')).toEqual({ host: 'gitlab.com', owner: 'group/sub', repo: 'app' });
  });

  it('has no address for a local identity', () => {
    expect(parseRepositoryIdentity('local:abc123')).toBeNull();
  });

  it('spells a cloud run the way a device spells its remote, and they compare equal', () => {
    const cloud = repositoryIdentityOf({ provider: 'github', host: null, owner: 'Acme', repo: 'App' });
    expect(cloud).toBe('https://github.com/Acme/App');
    expect(sameRepository(parseRepositoryIdentity(cloud)!, parseRepositoryIdentity('git@github.com:acme/app.git')!)).toBe(true);
  });
});
