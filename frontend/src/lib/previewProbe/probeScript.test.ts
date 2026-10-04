// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PREVIEW_PROBE_REQUEST, PREVIEW_PROBE_RESULT, PREVIEW_PROBE_SCRIPT, withPreviewProbe } from './probeScript';
import { probeResultFrom } from './probeReport';
import { probeUrl } from './runPreviewProbe';

const scriptBody = PREVIEW_PROBE_SCRIPT.replace(/^<script>/, '').replace(/<\/script>$/, '');

describe('withPreviewProbe', () => {
  it('injects into the mounted entry document only', () => {
    const files = { 'index.html': '<html><head><title>x</title></head><body></body></html>', 'src/App.jsx': 'x' };
    const out = withPreviewProbe(files);
    expect(out['index.html']).toContain(PREVIEW_PROBE_REQUEST);
    expect(out['index.html'].indexOf(PREVIEW_PROBE_REQUEST)).toBeLessThan(out['index.html'].indexOf('<title>'));
    expect(out['src/App.jsx']).toBe('x');
    expect(files['index.html']).not.toContain(PREVIEW_PROBE_REQUEST);
  });

  it('passes a document with no <head> through untouched', () => {
    const files = { 'index.html': '<div id="root"></div>' };
    expect(withPreviewProbe(files)).toBe(files);
  });
});

describe('the probe inside the page', () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

  it('is valid script', () => {
    expect(() => new Function(scriptBody)).not.toThrow();
  });

  it('answers a request with a report for that id, measuring the named selectors', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<h1 class="hero-title">By the Power</h1><img src="/a.png"><button>Go</button>';
    new Function(scriptBody)();
    const replies: unknown[] = [];
    // The probe answers `event.source`; in the test the host and the page are one window.
    vi.spyOn(window, 'postMessage').mockImplementation((message: unknown) => { replies.push(message); });
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: PREVIEW_PROBE_REQUEST, id: 'r1', selectors: ['.hero-title', '.absent', '['] },
      source: window,
    }));
    await vi.advanceTimersByTimeAsync(1600);

    expect(replies).toHaveLength(1);
    const reply = replies[0] as { type: string; id: string };
    expect(reply.type).toBe(PREVIEW_PROBE_RESULT);
    const report = probeResultFrom(reply, 'r1');
    expect(report && 'selectors' in report).toBe(true);
    if (!report || 'error' in report) throw new Error('expected a report');
    expect(report.selectors.map((s) => [s.selector, s.count, s.error ?? null])).toEqual([
      ['.hero-title', 1, null],
      ['.absent', 0, null],
      ['[', 0, 'Invalid CSS selector'],
    ]);
    expect(report.selectors[0].matches[0].text).toBe('By the Power');
  });

  it('ignores messages that are not probe requests', async () => {
    vi.useFakeTimers();
    new Function(scriptBody)();
    const post = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'builderforce:visual-arm' }, source: window }));
    await vi.advanceTimersByTimeAsync(1600);
    expect(post).not.toHaveBeenCalled();
  });
});

describe('probeUrl', () => {
  it('resolves an in-app route or anchor against the preview', () => {
    expect(probeUrl('https://p.example/', '/pricing')).toBe('https://p.example/pricing');
    expect(probeUrl('https://p.example/app/', '#characters')).toBe('https://p.example/app/#characters');
    expect(probeUrl('https://p.example/', '')).toBe('https://p.example/');
  });
});
