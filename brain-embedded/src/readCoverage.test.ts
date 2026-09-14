import { describe, it, expect } from 'vitest';
import { ReadCoverage, revisitAdvisory, withAdvisory, REVISIT_NUDGE_AT, REVISIT_HARD_AT } from './readCoverage';

const CSS = 'frontend/src/components/home/LandingCanvasHero.module.css';

describe('ReadCoverage', () => {
  it('counts overlapping windows over ONE file as visits to one target', () => {
    const cov = new ReadCoverage();
    let last = cov.record('read_file', { path: CSS, offset: 1 })!;
    for (const offset of [140, 141, 208, 240, 340, 440]) {
      last = cov.record('read_file', { path: CSS, offset })!;
    }
    // The exact-repeat guard sees seven DIFFERENT calls here and stays silent; this
    // is the whole reason the target tally exists.
    expect(last.count).toBe(7);
  });

  it('keeps different files apart', () => {
    const cov = new ReadCoverage();
    cov.record('read_file', { path: 'a.css' });
    const b = cov.record('read_file', { path: 'b.css' })!;
    expect(b.count).toBe(1);
  });

  it('keeps different TOOLS on the same file apart', () => {
    const cov = new ReadCoverage();
    cov.record('read_file', { path: CSS });
    expect(cov.record('search_code', { path: CSS })!.count).toBe(1);
  });

  /**
   * Chat #105: sixteen DIFFERENT searches under `frontend/src` were tallied as one target
   * visited sixteen times, so the model was told to STOP RE-READING while it explored.
   */
  it('keeps different QUESTIONS of one scope apart, and still counts the same question twice', () => {
    const cov = new ReadCoverage();
    cov.record('search_code', { query: 'RoomScene', path: 'frontend/src' });
    expect(cov.record('search_code', { query: 'scrollIntoView', path: 'frontend/src' })!.count).toBe(1);
    expect(cov.record('search_code', { query: 'RoomScene', path: './frontend/src/' })!.count).toBe(1);
    expect(cov.record('search_code', { query: 'RoomScene', path: 'frontend/src' })!.count).toBe(2);
  });

  it('forgets a search scoped to the file an edit just changed', () => {
    const cov = new ReadCoverage();
    cov.record('search_code', { query: 'height', path: CSS });
    cov.record('search_code', { query: 'height', path: CSS });
    cov.invalidate('edit_file', { path: CSS });
    expect(cov.record('search_code', { query: 'height', path: CSS })!.count).toBe(1);
  });

  it('ignores a call with no discernible target', () => {
    expect(new ReadCoverage().record('list_files', { recursive: true })).toBeNull();
  });

  it('remembers the distinct argument sets, without duplicating them', () => {
    const cov = new ReadCoverage();
    cov.record('read_file', { path: CSS, offset: 1 });
    cov.record('read_file', { path: CSS, offset: 1 });
    const v = cov.record('read_file', { path: CSS, offset: 2 })!;
    expect(v.count).toBe(3);
    expect(v.priorArgs).toHaveLength(2);
  });

  it('forgets the MUTATED target — a read after a change is new information', () => {
    const cov = new ReadCoverage();
    cov.record('read_file', { path: CSS });
    cov.record('read_file', { path: CSS });
    cov.invalidate('edit_file', { path: CSS });
    expect(cov.record('read_file', { path: CSS })!.count).toBe(1);
  });

  /**
   * The reason this guard was almost inert. Clearing the WHOLE tally on every non-read
   * call meant one edit, ticket write or failed dispatch erased the history of every
   * other file in the run — and in a run that interleaves reads with platform writes
   * the counter never reached the nudge. Measured: one CSS file read 14 times and its
   * component 13, across 78 calls, with the advisory firing on neither.
   */
  it('keeps the tally for every target the mutation did NOT touch', () => {
    const cov = new ReadCoverage();
    cov.record('read_file', { path: CSS });
    cov.record('read_file', { path: 'other.tsx' });
    cov.record('read_file', { path: 'other.tsx' });
    cov.invalidate('edit_file', { path: CSS });
    expect(cov.record('read_file', { path: 'other.tsx' })!.count).toBe(3);
  });

  it('invalidates a target across every tool that reads it', () => {
    const cov = new ReadCoverage();
    cov.record('search_code', { path: CSS });
    cov.record('read_file', { path: CSS });
    cov.invalidate('write_file', { path: CSS });
    expect(cov.record('search_code', { path: CSS })!.count).toBe(1);
    expect(cov.record('read_file', { path: CSS })!.count).toBe(1);
  });

  it('invalidates NOTHING for a write that touched no file', () => {
    // A ticket write, a sign-off, a refused dispatch: none of them changed anything on
    // disk that this tally describes, so none of them earns the model a clean slate.
    const cov = new ReadCoverage();
    cov.record('read_file', { path: CSS });
    cov.record('read_file', { path: CSS });
    cov.invalidate('builtin_tickets_from_delta', { chatId: 99, summary: 'x' });
    expect(cov.record('read_file', { path: CSS })!.count).toBe(3);
  });

  /**
   * The hole that made this guard inert for any run that VERIFIES its work.
   *
   * A shell command's blast radius is unknown, so no cached answer may survive it —
   * but the visit TALLY is a record of the model's own behaviour, not of the bytes on
   * disk, and clearing it handed a clean slate to every run that interleaves reads with
   * a build. Measured on a real run: 99 calls, 46% of them revisiting ground already
   * covered (one directory searched 6 times, one migrations folder listed 5), 14 exact
   * duplicates — and the advisory never fired once, because a `run_command` typecheck
   * kept resetting the counter below the threshold of 3.
   */
  it('keeps counting across a shell command, excusing only the FIRST read after it', () => {
    const cov = new ReadCoverage();
    cov.record('read_file', { path: CSS });
    cov.record('read_file', { path: CSS });
    cov.invalidate('run_command', { command: 'pnpm typecheck' });
    // The read straight after the build is genuinely new information — counted, excused.
    const afterBuild = cov.record('read_file', { path: CSS })!;
    expect(afterBuild.count).toBe(3);
    expect(afterBuild.mayHaveChanged).toBe(true);
    expect(revisitAdvisory('read_file', CSS, afterBuild)).toBeNull();
    // The one after that, with nothing in between, is circling — and now says so.
    const circling = cov.record('read_file', { path: CSS })!;
    expect(circling.count).toBe(4);
    expect(circling.mayHaveChanged).toBe(false);
    expect(revisitAdvisory('read_file', CSS, circling)).toContain(CSS);
  });

  it('drops every cached ANSWER after a shell command, so no repeat is stubbed out', () => {
    const cov = new ReadCoverage();
    cov.record('read_file', { path: CSS });
    cov.record('builtin_tasks_list', { projectId: 11 });
    cov.invalidate('run_command', { command: 'npx prettier --write .' });
    expect(cov.isRepeat('read_file', { path: CSS })).toBe(false);
    expect(cov.isRepeat('builtin_tasks_list', { projectId: 11 })).toBe(false);
  });

  it('hands back a SNAPSHOT, so a caller cannot reset the live tally', () => {
    const cov = new ReadCoverage();
    cov.record('read_file', { path: CSS });
    const visit = cov.record('read_file', { path: CSS })!;
    visit.count = 0;
    expect(cov.record('read_file', { path: CSS })!.count).toBe(3);
  });
});

describe('ReadCoverage · the exact-repeat guard', () => {
  it('knows nothing until a read has SUCCEEDED', () => {
    const cov = new ReadCoverage();
    expect(cov.isRepeat('read_file', { path: CSS })).toBe(false);
    cov.record('read_file', { path: CSS });
    expect(cov.isRepeat('read_file', { path: CSS })).toBe(true);
  });

  it('fingerprints arguments regardless of key order', () => {
    const cov = new ReadCoverage();
    cov.record('read_file', { path: CSS, offset: 140 });
    expect(cov.isRepeat('read_file', { offset: 140, path: CSS })).toBe(true);
    expect(cov.isRepeat('read_file', { path: CSS, offset: 141 })).toBe(false);
  });

  it('covers target-less platform reads too', () => {
    const cov = new ReadCoverage();
    expect(cov.record('builtin_tasks_list', { projectId: 11 })).toBeNull();
    expect(cov.isRepeat('builtin_tasks_list', { projectId: 11 })).toBe(true);
  });

  it('forgets ONLY the edited file — a ticket write no longer re-arms every read in the run', () => {
    // The old dedupe set was cleared by every non-read call, which is why a run that
    // interleaves reads with platform writes never suppressed a single re-read.
    const cov = new ReadCoverage();
    cov.record('read_file', { path: CSS });
    cov.record('read_file', { path: 'other.tsx' });
    cov.invalidate('builtin_tickets_from_delta', { chatId: 99, summary: 'x' });
    expect(cov.isRepeat('read_file', { path: CSS })).toBe(true);
    expect(cov.isRepeat('read_file', { path: 'other.tsx' })).toBe(true);
    cov.invalidate('edit_file', { path: CSS });
    expect(cov.isRepeat('read_file', { path: CSS })).toBe(false);
    expect(cov.isRepeat('read_file', { path: 'other.tsx' })).toBe(true);
  });

  it('a platform write forgets the platform reads, not the file reads', () => {
    const cov = new ReadCoverage();
    cov.record('builtin_tasks_list', { projectId: 11 });
    cov.record('read_file', { path: CSS });
    cov.invalidate('builtin_tasks_update', { id: 2394, status: 'in_review' });
    expect(cov.isRepeat('builtin_tasks_list', { projectId: 11 })).toBe(false);
    expect(cov.isRepeat('read_file', { path: CSS })).toBe(true);
  });

  it('a git status / diff / commit changes nothing a read would see, so forgets nothing', () => {
    const cov = new ReadCoverage();
    cov.record('read_file', { path: CSS });
    cov.record('builtin_tasks_list', { projectId: 11 });
    for (const tool of ['git_status', 'git_diff', 'git_commit', 'git_push', 'open_pull_request']) {
      cov.invalidate(tool, { repo: 'Builderforce.ai' });
    }
    expect(cov.isRepeat('read_file', { path: CSS })).toBe(true);
    expect(cov.isRepeat('builtin_tasks_list', { projectId: 11 })).toBe(true);
  });

  it('a shell command or a tree-rewriting git verb forgets everything', () => {
    for (const tool of ['run_command', 'git_sync_latest', 'git_undo', 'git_redo']) {
      const cov = new ReadCoverage();
      cov.record('read_file', { path: CSS });
      cov.record('builtin_tasks_list', { projectId: 11 });
      cov.invalidate(tool, {});
      expect(cov.isRepeat('read_file', { path: CSS })).toBe(false);
      expect(cov.isRepeat('builtin_tasks_list', { projectId: 11 })).toBe(false);
    }
  });
});

describe('ReadCoverage · fewer false misses', () => {
  it('treats spelling variants of one path as the same read', () => {
    const cov = new ReadCoverage();
    cov.record('search_code', { query: 'foo', path: 'api/src' });
    expect(cov.isRepeat('search_code', { query: ' foo ', path: './api/src/' })).toBe(true);
    expect(cov.isRepeat('search_code', { query: 'foo', path: 'api\\src' })).toBe(true);
    cov.record('read_file', { path: CSS });
    expect(cov.isRepeat('read_file', { path: CSS, offset: 1 })).toBe(true);
  });

  it('keeps every cached answer across a READ-ONLY shell command', () => {
    // The ticket review: `git branch -a`, `git log main..X`, a `for` loop of `git rev-list`
    // — nineteen shell calls that changed nothing, each of which used to wipe the cache.
    const cov = new ReadCoverage();
    cov.record('read_file', { path: CSS });
    cov.record('builtin_tasks_list', { projectId: 11 });
    cov.invalidate('run_command', { command: 'cd repo && git log main..builderforce/task-58 --oneline | head -5' });
    expect(cov.isRepeat('read_file', { path: CSS })).toBe(true);
    expect(cov.isRepeat('builtin_tasks_list', { projectId: 11 })).toBe(true);
    // …and does not excuse the next read as "may have changed".
    expect(cov.record('read_file', { path: CSS })!.mayHaveChanged).toBe(false);
  });

  it('forgets tree-wide answers when any file is edited, but not other files\' reads', () => {
    const cov = new ReadCoverage();
    cov.record('search_code', { query: 'newHelper' });
    cov.record('find_symbol', { query: 'newHelper' });
    cov.record('read_file', { path: 'other.tsx' });
    cov.invalidate('edit_file', { path: CSS });
    expect(cov.isRepeat('search_code', { query: 'newHelper' })).toBe(false);
    expect(cov.isRepeat('find_symbol', { query: 'newHelper' })).toBe(false);
    expect(cov.isRepeat('read_file', { path: 'other.tsx' })).toBe(true);
  });
});

describe('ReadCoverage · derived searches', () => {
  const wide = {
    ok: true,
    query: 'resolveRepo',
    total: 3,
    truncated: false,
    matches: [
      { path: 'api/src/a.ts', line: 1, text: 'resolveRepo()' },
      { path: 'api/src/llm/b.ts', line: 9, text: 'resolveRepo()' },
      { path: 'frontend/c.ts', line: 4, text: 'resolveRepo()' },
    ],
  };

  it('answers a narrower search from a complete wider one', () => {
    const cov = new ReadCoverage();
    cov.record('search_code', { query: 'resolveRepo' });
    cov.cacheResult('search_code', { query: 'resolveRepo' }, { result: wide, anchor: {} });
    const derived = cov.derivedSearch('search_code', { query: 'resolveRepo', path: 'api/src/llm' })!;
    expect(derived.total).toBe(1);
    expect((derived.matches as Array<{ path: string }>)[0].path).toBe('api/src/llm/b.ts');
    expect(String(derived.note)).toMatch(/not re-run/);
  });

  it('accepts a JSON-string result the host handed back unparsed', () => {
    const cov = new ReadCoverage();
    cov.record('search_code', { query: 'resolveRepo', path: 'api' });
    cov.cacheResult('search_code', { query: 'resolveRepo', path: 'api' }, { result: JSON.stringify(wide), anchor: {} });
    expect(cov.derivedSearch('search_code', { query: 'resolveRepo', path: 'api/src' })?.total).toBe(2);
  });

  it('never derives from a truncated result, a different query, or a sibling directory', () => {
    const cov = new ReadCoverage();
    cov.record('search_code', { query: 'resolveRepo', path: 'api/src' });
    cov.cacheResult('search_code', { query: 'resolveRepo', path: 'api/src' }, { result: { ...wide, truncated: true }, anchor: {} });
    expect(cov.derivedSearch('search_code', { query: 'resolveRepo', path: 'api/src/llm' })).toBeNull();
    cov.record('search_code', { query: 'other' });
    cov.cacheResult('search_code', { query: 'other' }, { result: wide, anchor: {} });
    expect(cov.derivedSearch('search_code', { query: 'resolveRepo', path: 'frontend' })).toBeNull();
    expect(cov.derivedSearch('search_code', { query: 'other', path: 'api/srcx' })?.total).toBe(0);
  });

  it('derives nothing for an unscoped search or another tool', () => {
    const cov = new ReadCoverage();
    cov.record('search_code', { query: 'x', path: 'a' });
    cov.cacheResult('search_code', { query: 'x', path: 'a' }, { result: wide, anchor: {} });
    expect(cov.derivedSearch('search_code', { query: 'x' })).toBeNull();
    expect(cov.derivedSearch('read_file', { path: 'a/b' })).toBeNull();
  });
});

/** n numbered lines so a served window's line count is n. */
function numberedLines(n: number): string {
  return Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n');
}

describe('ReadCoverage · covered read windows', () => {
  const complete400 = {
    ok: true,
    path: CSS,
    content: numberedLines(400),
    totalLines: 400,
    offset: 1,
    truncated: false,
  };

  it('covers a window fully inside an earlier complete read of the same file', () => {
    const cov = new ReadCoverage();
    cov.record('read_file', { path: CSS });
    cov.cacheResult('read_file', { path: CSS }, { result: complete400, anchor: {} });
    // Chat #109: offset 1050 then 1080 then 1105 of lines already returned.
    const hit = cov.coveredRead('read_file', { path: CSS, offset: 140, limit: 40 })!;
    expect(hit.start).toBe(140);
    expect(hit.end).toBe(179);
    expect(hit.cached?.result).toEqual(complete400);
    expect(hit.note).toMatch(/already returned/);
    expect(hit.note).toMatch(/offset 401/);
  });

  it('clips a default-size request to EOF of a complete shorter file', () => {
    const cov = new ReadCoverage();
    cov.record('read_file', { path: CSS });
    cov.cacheResult('read_file', { path: CSS }, { result: complete400, anchor: {} });
    // Asking for the default 1–2000 of a 400-line file is the same question.
    const hit = cov.coveredRead('read_file', { path: CSS })!;
    expect(hit.start).toBe(1);
    expect(hit.end).toBe(400);
  });

  it('does not cover a page that extends past a truncated window', () => {
    const cov = new ReadCoverage();
    cov.record('read_file', { path: CSS, offset: 1, limit: 2000 });
    cov.cacheResult('read_file', { path: CSS, offset: 1, limit: 2000 }, {
      result: { ok: true, path: CSS, content: numberedLines(2000), totalLines: 5000, offset: 1, truncated: true },
      anchor: {},
    });
    // 1900–2099 needs lines the truncated window did not return.
    expect(cov.coveredRead('read_file', { path: CSS, offset: 1900, limit: 200 })).toBeNull();
  });

  it('does not cover a jump to later uncovered lines', () => {
    const cov = new ReadCoverage();
    cov.record('read_file', { path: CSS, offset: 1, limit: 200 });
    cov.cacheResult('read_file', { path: CSS, offset: 1, limit: 200 }, {
      result: { ok: true, path: CSS, content: numberedLines(200), totalLines: 1000, offset: 1, truncated: true },
      anchor: {},
    });
    expect(cov.coveredRead('read_file', { path: CSS, offset: 400, limit: 80 })).toBeNull();
  });

  it('does not cover a different file or another tool', () => {
    const cov = new ReadCoverage();
    cov.record('read_file', { path: CSS });
    cov.cacheResult('read_file', { path: CSS }, { result: complete400, anchor: {} });
    expect(cov.coveredRead('read_file', { path: 'other.tsx', offset: 10, limit: 10 })).toBeNull();
    expect(cov.coveredRead('search_code', { path: CSS, query: 'x' })).toBeNull();
  });

  it('forgets coverage when the file is edited', () => {
    const cov = new ReadCoverage();
    cov.record('read_file', { path: CSS });
    cov.cacheResult('read_file', { path: CSS }, { result: complete400, anchor: {} });
    cov.invalidate('edit_file', { path: CSS });
    expect(cov.coveredRead('read_file', { path: CSS, offset: 140, limit: 40 })).toBeNull();
  });

  it('accepts a JSON-string result the host handed back unparsed', () => {
    const cov = new ReadCoverage();
    cov.record('read_file', { path: CSS });
    cov.cacheResult('read_file', { path: CSS }, { result: JSON.stringify(complete400), anchor: {} });
    expect(cov.coveredRead('read_file', { path: CSS, offset: 10, limit: 5 })?.start).toBe(10);
  });
});

describe('ReadCoverage · the replay cache', () => {
  it('holds nothing for a read that never succeeded', () => {
    const cov = new ReadCoverage();
    cov.cacheResult('read_file', { path: CSS }, { result: { ok: true }, anchor: {} });
    expect(cov.cachedResult('read_file', { path: CSS })).toBeNull();
  });

  it('hands back the result and anchor of a recorded read, keyed like the exact guard', () => {
    const cov = new ReadCoverage();
    const anchor = { role: 'tool' };
    cov.record('read_file', { path: CSS, offset: 1 });
    cov.cacheResult('read_file', { path: CSS, offset: 1 }, { result: { ok: true, content: 'body' }, anchor });
    // Key order must not matter — the same fingerprint the exact guard uses.
    const hit = cov.cachedResult('read_file', { offset: 1, path: CSS });
    expect(hit?.anchor).toBe(anchor);
    expect(hit?.result).toEqual({ ok: true, content: 'body' });
  });

  it('is forgotten together with the exact guard when the file is edited', () => {
    const cov = new ReadCoverage();
    cov.record('read_file', { path: CSS });
    cov.cacheResult('read_file', { path: CSS }, { result: { ok: true }, anchor: {} });
    cov.invalidate('edit_file', { path: CSS });
    expect(cov.cachedResult('read_file', { path: CSS })).toBeNull();
  });
});

describe('revisitAdvisory', () => {
  const visit = (count: number) => ({
    count,
    priorArgs: ['{"path":"a.css","offset":1}', '{"path":"a.css","offset":2}'],
    mayHaveChanged: false,
  });

  it('stays silent — at any count — when something unscoped ran since the last read', () => {
    // Re-reading after a build or a codemod is the RIGHT move; the guard must not
    // punish it. The count still stands, so the read after that is caught.
    expect(revisitAdvisory('read_file', CSS, { ...visit(REVISIT_HARD_AT), mayHaveChanged: true })).toBeNull();
  });

  it('stays silent for ordinary navigation', () => {
    for (let n = 1; n < REVISIT_NUDGE_AT; n += 1) {
      expect(revisitAdvisory('read_file', CSS, visit(n))).toBeNull();
    }
  });

  it('nudges at the threshold, naming the target and what was already tried', () => {
    const note = revisitAdvisory('read_file', CSS, visit(REVISIT_NUDGE_AT))!;
    expect(note).toContain(CSS);
    expect(note).toContain('3 times');
    expect(note).toContain('offset');
    // It has to offer the way OUT, not just report the problem — and the way out is to
    // page FORWARD from the last offset, never "read it whole" (the transcript budget
    // delivers a large file in windows, so that advice asked for the impossible).
    expect(note).toMatch(/page forward from the `offset`/i);
    expect(note).toMatch(/search for the specific symbol/i);
    expect(note).not.toMatch(/read the file whole/i);
  });

  it('escalates to an instruction once the nudge has demonstrably failed', () => {
    const note = revisitAdvisory('read_file', CSS, visit(REVISIT_HARD_AT))!;
    expect(note).toContain('STOP RE-READING');
    expect(note).toMatch(/make the edit, or state plainly what is blocking you/i);
    expect(note).toContain('exhausts its tool budget');
  });
});

describe('withAdvisory', () => {
  it('adds a note without disturbing the result shape', () => {
    const out = withAdvisory({ ok: true, content: 'x' }, 'careful') as Record<string, unknown>;
    expect(out.ok).toBe(true);
    expect(out.content).toBe('x');
    expect(out.note).toBe('careful');
  });

  it('appends to an existing note rather than overwriting the tool\'s own', () => {
    const out = withAdvisory({ ok: true, note: 'truncated' }, 'careful') as Record<string, unknown>;
    expect(out.note).toBe('truncated\n\ncareful');
  });

  it('wraps a non-object result so the original survives', () => {
    const out = withAdvisory('plain text', 'careful') as Record<string, unknown>;
    expect(out.result).toBe('plain text');
    expect(out.note).toBe('careful');
  });

  it('wraps an array rather than spreading it into an object', () => {
    const out = withAdvisory([1, 2], 'careful') as Record<string, unknown>;
    expect(out.result).toEqual([1, 2]);
  });
});
