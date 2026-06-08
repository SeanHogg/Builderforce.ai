import { describe, it, expect } from 'vitest';
import { parseRepoIdentifier, isValidRepoSegment } from './repoIdentifier';

describe('parseRepoIdentifier', () => {
  it('parses a full https URL', () => {
    expect(parseRepoIdentifier('https://github.com/acme/app')).toEqual({ host: 'github.com', owner: 'acme', repo: 'app' });
  });

  it('strips a trailing .git and path', () => {
    expect(parseRepoIdentifier('https://github.com/acme/app.git')).toEqual({ host: 'github.com', owner: 'acme', repo: 'app' });
    expect(parseRepoIdentifier('https://github.com/acme/app/tree/main')).toEqual({ host: 'github.com', owner: 'acme', repo: 'app' });
  });

  it('parses an enterprise host', () => {
    expect(parseRepoIdentifier('https://ghe.corp.local/acme/app')).toEqual({ host: 'ghe.corp.local', owner: 'acme', repo: 'app' });
  });

  it('parses an scp-style remote', () => {
    expect(parseRepoIdentifier('git@github.com:acme/app.git')).toEqual({ host: 'github.com', owner: 'acme', repo: 'app' });
  });

  it('parses owner/repo shorthand', () => {
    expect(parseRepoIdentifier('acme/app')).toEqual({ owner: 'acme', repo: 'app' });
  });

  it('returns null for a bare name or empty input', () => {
    expect(parseRepoIdentifier('acme')).toBeNull();
    expect(parseRepoIdentifier('   ')).toBeNull();
  });
});

describe('isValidRepoSegment', () => {
  it('accepts a single path segment', () => {
    expect(isValidRepoSegment('acme')).toBe(true);
    expect(isValidRepoSegment('my-repo.v2_final')).toBe(true);
  });

  it('rejects slashes, spaces, and URLs', () => {
    expect(isValidRepoSegment('acme/app')).toBe(false);
    expect(isValidRepoSegment('a b')).toBe(false);
    expect(isValidRepoSegment('https://github.com/acme/app')).toBe(false);
  });
});
