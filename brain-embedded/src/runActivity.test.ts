import { describe, it, expect } from 'vitest';
import { activityTarget, visitTarget, shortenTarget, toolActivity, describeLiveStep, midRunNotice, formatBytes } from './runActivity';

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

  it('names the COMMAND a shell call runs — the one tool that used to have no subject', () => {
    expect(activityTarget({ command: 'pnpm -w test' })).toBe('pnpm -w test');
    expect(activityTarget({ cmd: 'git status' })).toBe('git status');
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

describe('visitTarget', () => {
  it('keys a search by its scope AND its question — two searches of one folder are two visits', () => {
    const a = visitTarget({ path: 'frontend/src', query: 'RoomScene' });
    const b = visitTarget({ path: 'frontend/src', query: 'scrollIntoView' });
    expect(a).not.toBe(b);
    expect(a).toContain('frontend/src');
    expect(a).toContain('RoomScene');
  });

  it('is the plain target for a call that asks no question of it', () => {
    expect(visitTarget({ path: 'src/App.tsx', offset: 140 })).toBe('src/App.tsx');
    expect(visitTarget({ query: 'Board one-pager' })).toBe('Board one-pager');
    expect(visitTarget({ limit: 10 })).toBeUndefined();
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

describe('describeLiveStep', () => {
  it('says which tool, on what, and for how long', () => {
    const step = toolActivity('search_code', { query: 'Board one-pager' }, 4, 0);
    const line = describeLiveStep(step, 67_000);
    expect(line).toContain('running `search_code`');
    expect(line).toContain('on Board one-pager');
    expect(line).toContain('1m 7s so far');
    expect(line).toContain('loop step 4');
  });

  it('makes a paused confirm read as the USER blocking, not the agent working', () => {
    const step = { phase: 'awaiting' as const, label: 'edit_file', startedAt: 0, step: 2 };
    expect(describeLiveStep(step, 5_000)).toContain('PAUSED waiting for the user');
  });

  it('says a long turn was COMPOSING a call, and how much of it had arrived', () => {
    // Chat #113: 3m 23s of "streaming the reply" that was really a 21 KB write_file
    // call. The report has to name the tool and the size, or the turn reads as a hang.
    const step = { phase: 'composing' as const, label: 'write_file', bytes: 21_600, startedAt: 0, step: 16 };
    const line = describeLiveStep(step, 203_000);
    expect(line).toContain('composing a `write_file` call');
    expect(line).toContain('21.1 KB of arguments so far');
    expect(line).toContain('3m 23s so far');
    expect(line).toContain('loop step 16');
  });

  it('names a composing call before its first fragment is measured', () => {
    const line = describeLiveStep({ phase: 'composing', label: 'write_file', startedAt: 0, step: 1 }, 1_000);
    expect(line).toContain('composing a `write_file` call');
    expect(line).not.toContain('of arguments');
  });

  it('has a distinct description for every phase', () => {
    const phases = ['starting', 'thinking', 'writing', 'composing', 'tool', 'awaiting', 'finishing'] as const;
    const lines = phases.map((phase) => describeLiveStep({ phase, label: 'x', startedAt: 0, step: 1 }, 1_000));
    expect(new Set(lines).size).toBe(phases.length);
  });

  it('never renders a negative clock from a skewed timestamp', () => {
    expect(describeLiveStep({ phase: 'thinking', startedAt: 10_000, step: 1 }, 0)).toContain('0s so far');
  });
});

describe('midRunNotice', () => {
  it('warns that the run was UNFINISHED, and says what it was doing', () => {
    const notice = midRunNotice(toolActivity('read_file', { path: 'a.css' }, 3, 0), 12_000);
    expect(notice).toContain('CAPTURED MID-RUN');
    expect(notice).toContain('STILL EXECUTING');
    expect(notice).toContain('read_file');
    // The reason it exists: stopping a reader concluding "it never wrote the file".
    expect(notice).toContain('work it had not reached yet');
  });

  it('is still honest when no step was recorded', () => {
    expect(midRunNotice(null, 0)).toContain('No in-flight step was recorded');
  });

  it('carries a composing capture, so a mid-run report explains the silence', () => {
    const notice = midRunNotice({ phase: 'composing', label: 'write_file', bytes: 21_600, startedAt: 0, step: 16 }, 203_000);
    expect(notice).toContain('CAPTURED MID-RUN');
    expect(notice).toContain('composing a `write_file` call');
    expect(notice).toContain('21.1 KB of arguments so far');
  });
});

describe('formatBytes', () => {
  it('reads as bytes below a kilobyte and as KB above it', () => {
    expect(formatBytes(812)).toBe('812 B');
    expect(formatBytes(12_698)).toBe('12.4 KB');
    expect(formatBytes(21_600)).toBe('21.1 KB');
  });

  it('never renders a nonsense size', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(-5)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
  });
});
