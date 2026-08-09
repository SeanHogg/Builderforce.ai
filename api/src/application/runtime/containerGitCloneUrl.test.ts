import { describe, expect, it } from 'vitest';
import { containerGitCloneUrl } from './containerRunToken';

describe('containerGitCloneUrl', () => {
  it('targets only the execution-scoped proxy and safely encodes its HMAC', () => {
    const url = new URL(containerGitCloneUrl('https://api.example.test', 42, 'a:b/c'));
    expect(url.pathname).toBe('/api/runtime/internal/container-git/42.git');
    expect(url.username).toBe('x-access-token');
    expect(url.password).toBe('a%3Ab%2Fc');
    expect(url.hostname).toBe('api.example.test');
  });
});
