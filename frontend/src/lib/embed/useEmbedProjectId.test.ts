import { describe, it, expect } from 'vitest';
import { projectFromQuery, projectFromHash, resolveEmbedProjectId } from './useEmbedProjectId';

describe('useEmbedProjectId parsers — accept ?project= AND #projectId=', () => {
  it('reads the ?project=<id> query form', () => {
    expect(projectFromQuery('?project=42')).toBe(42);
    expect(projectFromQuery('project=42')).toBe(42); // no leading ?
    expect(projectFromQuery('?foo=1&project=7')).toBe(7);
  });

  it('reads the #projectId=<id> hash form (the VS Code extension deep-link)', () => {
    expect(projectFromHash('#projectId=99')).toBe(99);
    expect(projectFromHash('projectId=99')).toBe(99); // no leading #
    expect(projectFromHash('#view=board&projectId=3')).toBe(3);
  });

  it('does not cross-read (hash form is NOT a query param and vice-versa)', () => {
    expect(projectFromQuery('?projectId=5')).toBeNull(); // query uses `project`, not `projectId`
    expect(projectFromHash('#project=5')).toBeNull(); // hash uses `projectId`, not `project`
  });

  it('rejects non-positive / non-numeric ids', () => {
    expect(projectFromQuery('?project=0')).toBeNull();
    expect(projectFromQuery('?project=-3')).toBeNull();
    expect(projectFromQuery('?project=abc')).toBeNull();
    expect(projectFromHash('#projectId=')).toBeNull();
    expect(projectFromQuery('')).toBeNull();
    expect(projectFromHash('')).toBeNull();
  });

  it('floors a fractional id and returns null at portfolio scope', () => {
    expect(projectFromQuery('?project=12.9')).toBe(12);
    expect(resolveEmbedProjectId('', '')).toBeNull();
  });

  it('query wins when both forms carry a project', () => {
    expect(resolveEmbedProjectId('?project=1', '#projectId=2')).toBe(1);
  });

  it('falls back to the hash form when the query is absent (the VS Code case)', () => {
    expect(resolveEmbedProjectId('', '#projectId=2')).toBe(2);
    expect(resolveEmbedProjectId('?other=x', '#projectId=8')).toBe(8);
  });
});
