import { describe, expect, it } from 'vitest';
import { wildcardPath } from './index';

const ctx = (routePath: string, path: string) => ({ req: { routePath, path } });

describe('wildcardPath', () => {
  it('returns what the trailing star matched, decoded per segment', () => {
    expect(wildcardPath(ctx('/api/ide/projects/:projectId/files/*', '/api/ide/projects/50/files/src/App.jsx'))).toBe('src/App.jsx');
    expect(wildcardPath(ctx('/uploads/*', '/uploads/a%20b.png'))).toBe('a b.png');
  });

  it('keeps a repeated segment and an empty segment intact', () => {
    expect(wildcardPath(ctx('/api/brain/uploads/*', '/api/brain/uploads/uploads/x.png'))).toBe('uploads/x.png');
    expect(wildcardPath(ctx('/files/*', '/files/a//b'))).toBe('a//b');
  });

  it('is empty when there is no trailing wildcard or nothing matched', () => {
    expect(wildcardPath(ctx('/files/:id', '/files/1'))).toBe('');
    expect(wildcardPath(ctx('/files/*', '/files'))).toBe('');
    expect(wildcardPath(ctx('/files/*', '/files/%zz'))).toBe('%zz');
  });
});
