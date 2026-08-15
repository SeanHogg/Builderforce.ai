import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_DETAIL_CHARS,
  MAX_FAILURES_PER_BUILD,
  PREVIEW_ERROR_MESSAGE,
  clearBuildFailures,
  formatBuildFailures,
  previewErrorFrom,
  readBuildFailures,
  recordBuildFailure,
  subscribeBuildFailures,
  teeOutput,
  withPreviewErrorReporter,
} from './buildDiagnostics';

const PROJECT = 900;

beforeEach(() => clearBuildFailures(PROJECT));

describe('recordBuildFailure', () => {
  it('records a build failure with its command and exit code', () => {
    recordBuildFailure(PROJECT, { source: 'build', command: 'npm install', exitCode: 1, message: 'npm install failed (exit 1).' });
    const [failure] = readBuildFailures(PROJECT);
    expect(failure).toMatchObject({ source: 'build', command: 'npm install', exitCode: 1, count: 1 });
  });

  // A crashing render loop emits the same error thousands of times a second. The
  // useful fact is "this happened 400 times", not 400 copies of one message.
  it('collapses consecutive identical failures into a count', () => {
    for (let i = 0; i < 5; i += 1) {
      recordBuildFailure(PROJECT, { source: 'runtime', message: 'x is not a function' });
    }
    const failures = readBuildFailures(PROJECT);
    expect(failures).toHaveLength(1);
    expect(failures[0].count).toBe(5);
    expect(failures[0].lastSeen).toBeGreaterThanOrEqual(failures[0].firstSeen);
  });

  it('keeps distinct failures separate', () => {
    recordBuildFailure(PROJECT, { source: 'runtime', message: 'first' });
    recordBuildFailure(PROJECT, { source: 'runtime', message: 'second' });
    expect(readBuildFailures(PROJECT).map((f) => f.message)).toEqual(['first', 'second']);
  });

  it('bounds the buffer to the most recent failures', () => {
    for (let i = 0; i < MAX_FAILURES_PER_BUILD + 10; i += 1) {
      recordBuildFailure(PROJECT, { source: 'runtime', message: `error ${i}` });
    }
    const failures = readBuildFailures(PROJECT);
    expect(failures).toHaveLength(MAX_FAILURES_PER_BUILD);
    expect(failures[failures.length - 1].message).toBe(`error ${MAX_FAILURES_PER_BUILD + 9}`);
  });

  it('clips a long detail to its TAIL, where the cause is', () => {
    const detail = `${'a'.repeat(MAX_DETAIL_CHARS * 2)}THE REAL ERROR`;
    recordBuildFailure(PROJECT, { source: 'build', message: 'build failed', detail });
    const [failure] = readBuildFailures(PROJECT);
    expect(failure.detail).toContain('THE REAL ERROR');
    expect(failure.detail!.length).toBeLessThanOrEqual(MAX_DETAIL_CHARS + 2);
  });

  it('ignores an empty message and an invalid project id', () => {
    recordBuildFailure(PROJECT, { source: 'build', message: '   ' });
    recordBuildFailure(0, { source: 'build', message: 'nope' });
    expect(readBuildFailures(PROJECT)).toHaveLength(0);
  });

  it('notifies subscribers and survives a throwing one', () => {
    const good = vi.fn();
    const offBad = subscribeBuildFailures(() => { throw new Error('bad subscriber'); });
    const offGood = subscribeBuildFailures(good);
    expect(() => recordBuildFailure(PROJECT, { source: 'build', message: 'boom' })).not.toThrow();
    expect(good).toHaveBeenCalledWith(PROJECT);
    offBad();
    offGood();
  });
});

describe('formatBuildFailures', () => {
  it('returns null when there is nothing to repair', () => {
    expect(formatBuildFailures(PROJECT)).toBeNull();
  });

  it('labels the source and carries command, exit code, repeats and location', () => {
    recordBuildFailure(PROJECT, { source: 'build', command: 'npm run build', exitCode: 2, message: 'build failed', detail: 'TS2304' });
    recordBuildFailure(PROJECT, { source: 'runtime', message: 'x is not a function', at: 'src/App.jsx:12:3' });
    recordBuildFailure(PROJECT, { source: 'runtime', message: 'x is not a function', at: 'src/App.jsx:12:3' });
    const report = formatBuildFailures(PROJECT)!;
    expect(report).toContain('[BUILD · `npm run build` · exit 2] build failed');
    expect(report).toContain('TS2304');
    expect(report).toContain('[RUNTIME · ×2] x is not a function');
    expect(report).toContain('at src/App.jsx:12:3');
  });
});

describe('teeOutput', () => {
  it('passes every chunk through to the terminal and keeps the tail', () => {
    const seen: string[] = [];
    const log = teeOutput((data) => seen.push(data));
    log.write('one ');
    log.write('two');
    expect(seen).toEqual(['one ', 'two']);
    expect(log.text()).toBe('one two');
  });

  it('bounds what it holds so a long install cannot grow without limit', () => {
    const log = teeOutput(() => {});
    for (let i = 0; i < 50; i += 1) log.write('x'.repeat(1_000));
    expect(log.text().length).toBeLessThanOrEqual(MAX_DETAIL_CHARS * 2);
  });
});

describe('withPreviewErrorReporter', () => {
  it('injects the reporter at the START of head, before the app evaluates', () => {
    const files = { 'index.html': '<html><head><title>x</title></head><body></body></html>', 'src/main.jsx': 'x' };
    const out = withPreviewErrorReporter(files);
    const html = out['index.html'];
    expect(html.indexOf('builderforce:preview-error')).toBeLessThan(html.indexOf('<title>'));
    // Everything else is passed through untouched.
    expect(out['src/main.jsx']).toBe('x');
  });

  it('leaves files alone when there is no head to inject into', () => {
    const files = { 'index.html': 'not really html' };
    expect(withPreviewErrorReporter(files)).toBe(files);
    expect(withPreviewErrorReporter({})).toEqual({});
  });
});

describe('previewErrorFrom', () => {
  it('parses a reporter message', () => {
    const parsed = previewErrorFrom({
      type: PREVIEW_ERROR_MESSAGE,
      payload: { message: 'x is not a function', at: 'src/App.jsx:1:1', detail: 'stack' },
    });
    expect(parsed).toEqual({ source: 'runtime', message: 'x is not a function', at: 'src/App.jsx:1:1', detail: 'stack' });
  });

  it('ignores anything that is not ours', () => {
    expect(previewErrorFrom(null)).toBeNull();
    expect(previewErrorFrom('a string')).toBeNull();
    expect(previewErrorFrom({ type: 'webpack/hmr' })).toBeNull();
    expect(previewErrorFrom({ type: PREVIEW_ERROR_MESSAGE, payload: { message: '  ' } })).toBeNull();
    // A hostile sender cannot smuggle a non-string through.
    expect(previewErrorFrom({ type: PREVIEW_ERROR_MESSAGE, payload: { message: 'ok', at: { toString: () => 'x' } } }))
      .toEqual({ source: 'runtime', message: 'ok', at: undefined, detail: undefined });
  });
});
