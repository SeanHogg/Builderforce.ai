import { describe, expect, it } from 'vitest';
import { assessProbe, probeResultFrom, type ProbeReport } from './probeReport';
import { PREVIEW_PROBE_RESULT } from './probeScript';

const report = (patch: Partial<ProbeReport> = {}): ProbeReport => ({
  url: '/', title: 'He-Man', viewport: { width: 390, height: 844 },
  documentWidth: 390, documentHeight: 3000, pageOverflowXHidden: false,
  overflowing: [], overflowingCount: 0,
  smallTargets: [], smallTargetCount: 0,
  clippedText: [], clippedTextCount: 0,
  brokenImages: [], imagesWithoutAlt: [], imagesWithoutAltCount: 0,
  errors: [], selectors: [],
  ...patch,
});

describe('probeResultFrom', () => {
  it('ignores messages that are not this request\'s result', () => {
    expect(probeResultFrom(null, 'a')).toBeNull();
    expect(probeResultFrom({ type: 'builderforce:preview-error', id: 'a' }, 'a')).toBeNull();
    expect(probeResultFrom({ type: PREVIEW_PROBE_RESULT, id: 'b', report: {} }, 'a')).toBeNull();
  });

  it('surfaces a probe that threw inside the page', () => {
    expect(probeResultFrom({ type: PREVIEW_PROBE_RESULT, id: 'a', report: { error: 'boom' } }, 'a')).toEqual({ error: 'boom' });
  });

  it('re-reads every field defensively, dropping junk', () => {
    const parsed = probeResultFrom({
      type: PREVIEW_PROBE_RESULT, id: 'a',
      report: {
        viewport: { width: 390, height: 'tall' },
        documentWidth: 512,
        overflowing: [{ element: 'img.hero', left: 0, right: 512, width: 512, position: 'static' }, 'junk'],
        errors: ['x', 7],
        selectors: [{ selector: '.tag', count: 1, matches: [{ element: 'span.tag', rect: { x: 1, y: 2, width: 74, height: 23 }, style: { height: '23px', bogus: 3 }, visible: true }] }],
      },
    }, 'a');
    expect(parsed && 'viewport' in parsed).toBe(true);
    const ok = parsed as ProbeReport;
    expect(ok.viewport).toEqual({ width: 390, height: 0 });
    expect(ok.overflowing).toHaveLength(1);
    expect(ok.errors).toEqual(['x']);
    expect(ok.selectors[0].matches[0].style).toEqual({ height: '23px' });
    expect(ok.selectors[0].matches[0].occludedBy).toBeNull();
  });
});

describe('assessProbe', () => {
  it('passes a clean page', () => {
    expect(assessProbe(report())).toEqual({ passed: true, failures: [], warnings: [] });
  });

  it('fails a page that scrolls sideways', () => {
    const verdict = assessProbe(report({ documentWidth: 512 }));
    expect(verdict.passed).toBe(false);
    expect(verdict.failures[0]).toMatch(/scrolls sideways by 122px/);
  });

  /** Chat #129's mobile "fix" hid the overflow with overflow-x: hidden — cut off, not fixed. */
  it('fails content past the edge even when overflow-x: hidden stops the scroll', () => {
    const verdict = assessProbe(report({
      pageOverflowXHidden: true,
      overflowing: [{ element: 'div.hero-image-container', left: 120, right: 560, width: 440, position: 'relative' }],
      overflowingCount: 1,
    }));
    expect(verdict.passed).toBe(false);
    expect(verdict.failures[0]).toMatch(/cut off by overflow-x: hidden/);
  });

  it('only warns about a fixed drawer parked off-screen', () => {
    const verdict = assessProbe(report({
      overflowing: [{ element: 'nav#primary-nav', left: 390, right: 690, width: 300, position: 'fixed' }],
      overflowingCount: 1,
    }));
    expect(verdict.passed).toBe(true);
    expect(verdict.warnings[0]).toMatch(/closed drawer/);
  });

  it('fails broken images, runtime errors, unmatched and covered selectors', () => {
    const verdict = assessProbe(report({
      brokenImages: [{ element: 'img', src: '/he-man.jpg' }],
      errors: ['TypeError: x is undefined'],
      selectors: [
        { selector: '.missing', count: 0, matches: [] },
        { selector: '.hero h1', count: 1, matches: [{ element: 'h1', text: 'By the Power', visible: true, rect: { x: 0, y: 0, width: 300, height: 80 }, inViewport: true, style: {}, occludedBy: 'img.hero-character-image' }] },
        { selector: '[', count: 0, matches: [], error: 'Invalid CSS selector' },
      ],
    }));
    expect(verdict.passed).toBe(false);
    expect(verdict.failures).toEqual([
      'image did not load: /he-man.jpg (img)',
      'runtime error: TypeError: x is undefined',
      'selector ".missing" matches nothing at 390px',
      '".hero h1" → h1 is covered by img.hero-character-image at 390px',
      'selector "[": Invalid CSS selector',
    ]);
  });

  it('keeps small targets, missing alt text, hidden matches and clipped text as warnings', () => {
    const verdict = assessProbe(report({
      smallTargetCount: 3, imagesWithoutAltCount: 1, clippedTextCount: 2,
      selectors: [{ selector: '.nav', count: 1, matches: [{ element: 'nav.nav', text: '', visible: false, rect: { x: 0, y: 0, width: 0, height: 0 }, inViewport: false, style: {}, occludedBy: null }] }],
    }));
    expect(verdict.passed).toBe(true);
    expect(verdict.warnings).toHaveLength(4);
  });
});
