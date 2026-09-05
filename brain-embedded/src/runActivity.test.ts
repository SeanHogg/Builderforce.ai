import { describe, it, expect } from 'vitest';
import { activityTarget, shortenTarget, toolActivity } from './runActivity';

describe('activityTarget', () => {
  it('names the file a read is aimed at', () => {
    expect(activityTarget({ path: 'src/App.tsx', offset: 140 })).toBe('src/App.tsx');
  });

  it('prefers the path over a secondary key when a call carries both', () => {
    expect(activityTarget({ path: 'src/App.tsx', query: 'height' })).toBe('src/App.tsx');
  });

  it('falls back to the query for a search', () => {
    expect(activityTarget({ query: 'Board one-pager' })).toBe('Board one-pager');
  });

  it('accepts a numeric id — an update on #42 has a subject too', () => {
    expect(activityTarget({ id: 42 })).toBe('42');
  });

  it('returns undefined rather than inventing a subject', () => {
    expect(activityTarget({ limit: 10, recursive: true })).toBeUndefined();
    expect(activityTarget(undefined)).toBeUndefined();
    expect(activityTarget('not an object')).toBeUndefined();
    expect(activityTarget([1, 2])).toBeUndefined();
  });

  it('ignores an empty string — a blank path names nothing', () => {
    expect(activityTarget({ path: '   ' })).toBeUndefined();
  });
});

describe('shortenTarget', () => {
  it('keeps the basename of a long path — that is what identifies it', () => {
    const long = 'Builderforce.ai/frontend/src/components/home/LandingCanvasHero.module.css';
    const short = shortenTarget(long, 30);
    expect(short.length).toBeLessThanOrEqual(30);
    expect(short).toContain('LandingCanvasHero.module.css');
  });

  it('elides a long non-path from the right', () => {
    const short = shortenTarget('a'.repeat(200), 20);
    expect(short.length).toBe(20);
    expect(short.endsWith('…')).toBe(true);
  });

  it('collapses whitespace so a multi-line query stays one line', () => {
    expect(shortenTarget('find   the\nheight')).toBe('find the height');
  });
});

describe('toolActivity', () => {
  it('carries the tool, its subject and the clock the renderer ticks from', () => {
    const a = toolActivity('read_file', { path: 'a.css' }, 3, 1_000);
    expect(a).toEqual({ phase: 'tool', label: 'read_file', detail: 'a.css', startedAt: 1_000, step: 3 });
  });

  it('omits the subject entirely when the call has none', () => {
    expect(toolActivity('list_files', {}, 1, 0).detail).toBeUndefined();
  });
});
