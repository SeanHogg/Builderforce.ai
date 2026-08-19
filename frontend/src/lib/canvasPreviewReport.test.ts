import { describe, expect, it } from 'vitest';
import {
  CANVAS_PREVIEW_MESSAGE,
  CANVAS_PREVIEW_REPORT_LIMIT,
  CANVAS_PREVIEW_REPORTER,
  appendCanvasPreviewEntry,
  canvasPreviewEntry,
  canvasPreviewReportLog,
  canvasPreviewStatusFailed,
  canvasPreviewSummary,
  type CanvasPreviewEntry,
} from './canvasPreviewReport';

const line = (level: CanvasPreviewEntry['level'], text: string, at: number): CanvasPreviewEntry =>
  ({ level, text, at });

describe('canvasPreviewEntry', () => {
  it('accepts a well-formed message', () => {
    expect(canvasPreviewEntry({ tag: CANVAS_PREVIEW_MESSAGE, level: 'error', text: 'boom', at: 42 }))
      .toEqual({ level: 'error', text: 'boom', at: 42 });
  });

  /** The sender is a page under test — on a `browser` card, a third-party site nobody on
   *  the board wrote. Every field is re-validated rather than trusted. */
  it('refuses anything that is not this protocol', () => {
    expect(canvasPreviewEntry(null)).toBeNull();
    expect(canvasPreviewEntry('builderforce:canvas-preview')).toBeNull();
    expect(canvasPreviewEntry({ level: 'error', text: 'boom' })).toBeNull();
    expect(canvasPreviewEntry({ tag: 'something-else', level: 'error', text: 'boom' })).toBeNull();
    expect(canvasPreviewEntry({ tag: CANVAS_PREVIEW_MESSAGE, level: 'fatal', text: 'boom' })).toBeNull();
  });

  it('bounds a single line and a nonsense timestamp rather than dropping the message', () => {
    const entry = canvasPreviewEntry({
      tag: CANVAS_PREVIEW_MESSAGE, level: 'log', text: 'x'.repeat(5_000), at: -3,
    });
    expect(entry?.text).toHaveLength(500);
    expect(entry?.at).toBe(0);
    expect(canvasPreviewEntry({ tag: CANVAS_PREVIEW_MESSAGE, level: 'log', text: 'a', at: Infinity })?.at).toBe(0);
  });
});

describe('the live console budget', () => {
  it('keeps the tail rather than growing without bound', () => {
    let log: CanvasPreviewEntry[] = [];
    for (let index = 0; index < 260; index += 1) log = appendCanvasPreviewEntry(log, line('log', `#${index}`, index));
    expect(log).toHaveLength(200);
    expect(log[0]?.text).toBe('#60');
  });
});

describe('canvasPreviewSummary', () => {
  it('counts by level', () => {
    expect(canvasPreviewSummary([line('error', 'a', 1), line('warn', 'b', 2), line('request', 'c', 3), line('log', 'd', 4)]))
      .toEqual({ errors: 1, warnings: 1, requests: 1, reported: true });
  });

  /**
   * The distinction the whole feature rests on: a page that never reported is a page
   * whose console is UNKNOWN, which is not the same claim as "no errors". Conflating them
   * is exactly the "preview looks fine while it throws" defect, one layer up.
   */
  it('does not call a silent page a clean one', () => {
    expect(canvasPreviewSummary([]).reported).toBe(false);
    expect(canvasPreviewSummary([line('log', 'ready', 1)]).reported).toBe(true);
  });
});

describe('canvasPreviewReportLog', () => {
  /** Truncating by TIME would drop the throw on load and keep the request chatter that
   *  followed it, which is precisely backwards for the reader who has to act on it. */
  it('keeps the failures when the run is longer than the budget', () => {
    const log = [
      line('error', 'boom on load', 0),
      ...Array.from({ length: 60 }, (_unused, index) => line('request', `GET /api/${index}`, index + 1)),
      line('warn', 'deprecated', 80),
    ];
    const report = canvasPreviewReportLog(log);
    expect(report).toHaveLength(CANVAS_PREVIEW_REPORT_LIMIT);
    expect(report.map((entry) => entry.text)).toContain('boom on load');
    expect(report.map((entry) => entry.text)).toContain('deprecated');
    // Still in the order they happened, so the report reads as a run.
    expect(report.map((entry) => entry.at)).toEqual([...report.map((entry) => entry.at)].sort((a, b) => a - b));
  });

  it('drops the oldest failures once there are more failures than room', () => {
    const log = Array.from({ length: 20 }, (_unused, index) => line('error', `e${index}`, index));
    expect(canvasPreviewReportLog(log).map((entry) => entry.text))
      .toEqual(Array.from({ length: CANVAS_PREVIEW_REPORT_LIMIT }, (_unused, index) => `e${index + 8}`));
  });

  it('passes a short run through untouched', () => {
    const log = [line('request', 'GET /', 1), line('log', 'ready', 2)];
    expect(canvasPreviewReportLog(log)).toEqual(log);
  });
});

describe('canvasPreviewStatusFailed', () => {
  /** A styled 404 frames exactly as happily as the real page — which is why the status
   *  is the one half of "is this broken" that needs no cooperation from the page. */
  it('is true only for a status that says the page is not the page asked for', () => {
    expect(canvasPreviewStatusFailed(200)).toBe(false);
    expect(canvasPreviewStatusFailed(302)).toBe(false);
    expect(canvasPreviewStatusFailed(404)).toBe(true);
    expect(canvasPreviewStatusFailed(503)).toBe(true);
    // No probe yet is not a failure, and neither is a value nobody wrote.
    expect(canvasPreviewStatusFailed(undefined)).toBe(false);
    expect(canvasPreviewStatusFailed(null)).toBe(false);
    expect(canvasPreviewStatusFailed('500')).toBe(false);
  });
});

describe('CANVAS_PREVIEW_REPORTER', () => {
  it('carries the tag the reader matches on', () => {
    expect(CANVAS_PREVIEW_REPORTER).toContain(JSON.stringify(CANVAS_PREVIEW_MESSAGE));
  });

  /** Listening in the bubble phase misses a subresource that 404s, because a resource
   *  `error` fires on the element and never reaches `window`. */
  it('listens for resource failures in the capture phase', () => {
    expect(CANVAS_PREVIEW_REPORTER).toContain("window.addEventListener('error'");
    expect(CANVAS_PREVIEW_REPORTER).toMatch(/\},true\);/);
    expect(CANVAS_PREVIEW_REPORTER).toContain('failed to load');
  });

  it('reports a 4xx/5xx response as well as a call that never landed', () => {
    expect(CANVAS_PREVIEW_REPORTER).toContain('response.status>=400');
    expect(CANVAS_PREVIEW_REPORTER).toContain('no host is attached to this preview');
  });

  /** It is inlined into a `srcDoc`, so anything that closes the element it sits in would
   *  spill the rest of the document onto the page as text. */
  it('cannot terminate the script element it is written into', () => {
    expect(CANVAS_PREVIEW_REPORTER.slice('<script>'.length, -'</script>'.length)).not.toContain('</script');
  });
});
