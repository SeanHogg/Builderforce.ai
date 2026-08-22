/**
 * @vitest-environment jsdom
 *
 * The four conditions that decide whether a read is answered from the sample
 * workspace. Each one is here because getting it wrong has a specific, bad
 * consequence, and the test says which.
 */
import { describe, it, expect } from 'vitest';
import { resolveGuestRead, guestReadResponse, SAMPLE_DATA_HEADER } from './guestRead';
import { allGuestFixtures } from '../infrastructure/guestFixtureRegistry';

const read = (path: string, over: Partial<{ method: string; hadToken: boolean }> = {}) =>
  resolveGuestRead({ path, method: 'GET', hadToken: false, ...over });

describe('resolveGuestRead', () => {
  it('answers a covered read for a visitor who sent no credential', () => {
    const result = read('/api/projects');
    expect(result).not.toBeNull();
    const body = result!.body as { projects: unknown[] };
    expect(body.projects.length).toBeGreaterThan(0);
  });

  it('NEVER answers a request that carried a token', () => {
    // The condition is the absence of an Authorization header, not what any
    // React state believes about the session. A signed-in person served a
    // fixture would be shown somebody else's invented business as their own.
    expect(read('/api/projects', { hadToken: true })).toBeNull();
  });

  it('NEVER answers a write', () => {
    // Swallowing a guest's POST and reporting success is the failure that makes
    // a person believe their work is saved. Writes go to the wire and are
    // stopped at the control by <SessionGate> or by the server.
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(read('/api/projects', { method })).toBeNull();
    }
  });

  it('falls through when nothing covers the read', () => {
    // The reason coverage can grow one entry at a time without any point in
    // between being broken: an uncovered read gets an anonymous 401, which the
    // client already treats as "nobody is signed in" rather than a fault, and
    // the surface renders its own empty state.
    expect(read('/api/something-nobody-has-fixtured')).toBeNull();
  });

  it('hands the query string to the fixture', () => {
    const thirty = read('/api/insights/engineering?days=30')!.body as { windowDays: number };
    const ninety = read('/api/insights/engineering?days=90')!.body as { windowDays: number };
    expect(thirty.windowDays).toBe(30);
    expect(ninety.windowDays).toBe(90);
  });

  it('clamps a window the sample workspace cannot honestly answer', () => {
    const absurd = read('/api/insights/engineering?days=9999')!.body as { windowDays: number };
    expect(absurd.windowDays).toBe(90);
  });

  it('stamps the response so any layer can recognise sample data', () => {
    const response = guestReadResponse(read('/api/projects')!);
    expect(response.status).toBe(200);
    expect(response.headers.get(SAMPLE_DATA_HEADER)).toBe('delivery.projects');
  });
});

describe('the fixture registry', () => {
  it('has no duplicate ids, so first-match-wins is deterministic', () => {
    const ids = allGuestFixtures().map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resolves dates against the READ, never a literal in the fixture', () => {
    // A fixture with hard-coded ISO dates is fresh the day it is written and
    // visibly stale forever after: "a board mid-sprint" whose sprint ended last
    // spring reads as an abandoned product.
    const projects = (read('/api/projects')!.body as { projects: Array<{ createdAt: string }> }).projects;
    for (const project of projects) {
      expect(new Date(project.createdAt).getTime()).toBeLessThan(Date.now());
      expect(Number.isNaN(new Date(project.createdAt).getTime())).toBe(false);
    }
  });

  it('reports the same completed count to the board and to the dashboard', () => {
    // A demo whose Delivery lens and whose board disagree about last week is a
    // demo that argues with itself, and a visitor who spots it has learned
    // something true about how carefully we build.
    const projects = (read('/api/projects')!.body as {
      projects: Array<{ taskCount: number; completedTaskCount: number; openTaskCount: number }>;
    }).projects;
    const tasks = (read('/api/tasks')!.body as { tasks: unknown[] }).tasks;
    const totalFromProjects = projects.reduce((total, p) => total + p.taskCount, 0);
    expect(totalFromProjects).toBe(tasks.length);
    for (const project of projects) {
      expect(project.completedTaskCount + project.openTaskCount).toBe(project.taskCount);
    }
  });
});
