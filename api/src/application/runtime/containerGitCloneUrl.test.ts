import { describe, expect, it } from 'vitest';
import { containerGitUrl } from './containerRunToken';

describe('containerGitUrl', () => {
  it('targets only the execution-scoped proxy and carries NO credential', () => {
    const raw = containerGitUrl('https://api.example.test', 42);
    const url = new URL(raw);
    expect(url.pathname).toBe('/api/runtime/internal/container-git/42.git');
    expect(url.hostname).toBe('api.example.test');
    // The run token is supplied per git command by the sandbox, never embedded: `origin` must not hold it.
    expect(url.username).toBe('');
    expect(url.password).toBe('');
    expect(raw).not.toContain('@');
  });

  it('tolerates a base URL with or without a trailing slash', () => {
    expect(containerGitUrl('https://api.example.test/', 7)).toBe(containerGitUrl('https://api.example.test', 7));
  });
});
