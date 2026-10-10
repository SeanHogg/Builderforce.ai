import { describe, it, expect } from 'vitest';
import { projectFromLocation, resolveProjectId, toProjectId } from './projectScopeResolution';

describe('resolveProjectId — the one "which project?" order', () => {
  it('a pin wins over everything, and a null pin means portfolio', () => {
    expect(resolveProjectId({ pinned: 4, host: 5, location: 6, selected: 7 })).toBe(4);
    expect(resolveProjectId({ pinned: null, host: 5, location: 6, selected: 7 })).toBeNull();
  });

  it('a host-owned selection outranks the page (the editor sidebar)', () => {
    expect(resolveProjectId({ host: 5, location: 6, selected: 7 })).toBe(5);
    // The host owning the selection and choosing "all projects" is still the host's answer.
    expect(resolveProjectId({ host: null, location: 6, selected: 7 })).toBeNull();
  });

  it('a deep-link outranks the persisted pick, which outranks portfolio', () => {
    expect(resolveProjectId({ location: 6, selected: 7 })).toBe(6);
    expect(resolveProjectId({ location: null, selected: 7 })).toBe(7);
    expect(resolveProjectId({})).toBeNull();
  });
});

describe('projectFromLocation — every deep-link spelling in circulation', () => {
  it('reads ?project=, legacy ?projectId= and the editor #projectId=', () => {
    expect(projectFromLocation('?project=42')).toBe(42);
    expect(projectFromLocation('project=42')).toBe(42);
    expect(projectFromLocation('?foo=1&project=7')).toBe(7);
    expect(projectFromLocation('?projectId=5')).toBe(5);
    expect(projectFromLocation('', '#projectId=99')).toBe(99);
    expect(projectFromLocation('', 'view=board&projectId=3')).toBe(3);
  });

  it('?project= wins over ?projectId=, and the query wins over the hash', () => {
    expect(projectFromLocation('?project=1&projectId=2')).toBe(1);
    expect(projectFromLocation('?project=1', '#projectId=2')).toBe(1);
    expect(projectFromLocation('?other=x', '#projectId=8')).toBe(8);
  });

  it('does not read `project` from the hash', () => {
    expect(projectFromLocation('', '#project=5')).toBeNull();
  });

  it('rejects non-positive / non-numeric ids and floors fractions', () => {
    expect(projectFromLocation('?project=0')).toBeNull();
    expect(projectFromLocation('?project=-3')).toBeNull();
    expect(projectFromLocation('?project=abc')).toBeNull();
    expect(projectFromLocation('', '#projectId=')).toBeNull();
    expect(projectFromLocation('')).toBeNull();
    expect(projectFromLocation('?project=12.9')).toBe(12);
    expect(toProjectId(null)).toBeNull();
  });
});
