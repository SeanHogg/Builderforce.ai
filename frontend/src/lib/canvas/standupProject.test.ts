import { describe, it, expect } from 'vitest';
import { resolveStandupProject, stepStandupProject } from './standupProject';

/**
 * The precedence is the whole module, so these are the four sentences it exists
 * to make true — in the order a person would say them out loud.
 */
describe('resolveStandupProject', () => {
  it('takes what the meeting itself chose over everything else', () => {
    expect(resolveStandupProject({ chosen: 7, scopeProjectId: 2, boardProjectId: 3 }))
      .toEqual({ projectId: 7, source: 'chosen' });
  });

  /**
   * The distinction the whole input shape exists for. "Nobody has chosen in here"
   * and "somebody chose to run this against no project" are different answers,
   * and collapsing them would make an explicit All Projects silently fall back to
   * the scope it was overriding — the picker would appear not to work.
   */
  it('treats a deliberate "no project" as a choice, not as an absence', () => {
    expect(resolveStandupProject({ chosen: null, scopeProjectId: 2, boardProjectId: 3 }))
      .toEqual({ projectId: null, source: 'none' });
    expect(resolveStandupProject({ chosen: undefined, scopeProjectId: 2, boardProjectId: 3 }))
      .toEqual({ projectId: 2, source: 'scope' });
  });

  it('falls back to the project the person is working in', () => {
    expect(resolveStandupProject({ scopeProjectId: 5, boardProjectId: 9 }))
      .toEqual({ projectId: 5, source: 'scope' });
  });

  it('falls back to the project the board names when there is no scope', () => {
    expect(resolveStandupProject({ scopeProjectId: null, boardProjectId: 9 }))
      .toEqual({ projectId: 9, source: 'board' });
  });

  it('reports an unassociated standup rather than failing to answer', () => {
    expect(resolveStandupProject({})).toEqual({ projectId: null, source: 'none' });
    expect(resolveStandupProject({ scopeProjectId: null, boardProjectId: null }))
      .toEqual({ projectId: null, source: 'none' });
  });
});

describe('stepStandupProject', () => {
  const ids = [10, 20, 30];

  it('starts a walk from the unassociated slot into the first project', () => {
    expect(stepStandupProject(ids, null, 1)).toBe(10);
  });

  it('walks forward through every project', () => {
    expect(stepStandupProject(ids, 10, 1)).toBe(20);
    expect(stepStandupProject(ids, 20, 1)).toBe(30);
  });

  /**
   * The loop closes through `null` on purpose: a team that has been through every
   * project lands back on "no project", which is the moment they stop talking
   * about projects and talk about the company.
   */
  it('comes back around through the unassociated slot rather than stopping', () => {
    expect(stepStandupProject(ids, 30, 1)).toBeNull();
    expect(stepStandupProject(ids, null, -1)).toBe(30);
  });

  it('walks backward', () => {
    expect(stepStandupProject(ids, 20, -1)).toBe(10);
    expect(stepStandupProject(ids, 10, -1)).toBeNull();
  });

  it('restarts the walk when the current project has since been deleted', () => {
    expect(stepStandupProject(ids, 999, 1)).toBe(10);
    expect(stepStandupProject(ids, 999, -1)).toBe(30);
  });

  it('has nowhere to step with no projects, in either direction', () => {
    expect(stepStandupProject([], null, 1)).toBeNull();
    expect(stepStandupProject([], 4, -1)).toBeNull();
  });

  it('visits every project exactly once before repeating', () => {
    const seen: Array<number | null> = [];
    let at: number | null = null;
    for (let i = 0; i < ids.length + 1; i += 1) {
      at = stepStandupProject(ids, at, 1);
      seen.push(at);
    }
    expect(seen).toEqual([10, 20, 30, null]);
  });
});
