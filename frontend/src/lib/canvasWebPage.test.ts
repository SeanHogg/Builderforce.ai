import { describe, it, expect } from 'vitest';
import {
  canvasWebPageUrl, hasWebPageProbe, isLocalWebPageUrl, isMixedContentFrame, isWebPageKind,
  normalizeWebPageUrl, webPageHost,
} from './canvasWebPage';
import { CANVAS_VIEWPORT_WIDTHS, canvasViewport } from '@builderforce/creation-canvas-contract';
import type { CreationNodeData } from '@/components/creation-canvas/types';

const page = (data: Partial<CreationNodeData>): CreationNodeData => ({ kind: 'browser', title: 'Page', ...data });

describe('normalizeWebPageUrl', () => {
  it('keeps an absolute http(s) address', () => {
    expect(normalizeWebPageUrl('https://example.com/docs')).toBe('https://example.com/docs');
    expect(normalizeWebPageUrl('http://localhost:5173/')).toBe('http://localhost:5173/');
  });

  it('promotes a bare host to https — the overwhelmingly common paste', () => {
    expect(normalizeWebPageUrl('example.com')).toBe('https://example.com/');
    expect(normalizeWebPageUrl('  builderforce.ai/pricing  ')).toBe('https://builderforce.ai/pricing');
  });

  it('refuses every scheme that would run code or read local files in our own document', () => {
    for (const raw of ['javascript:alert(1)', 'data:text/html,<script>x</script>', 'file:///c:/secrets.txt', 'blob:https://example.com/abc', 'ftp://example.com']) {
      expect(normalizeWebPageUrl(raw), raw).toBeNull();
    }
  });

  it('refuses empty and non-string input', () => {
    for (const raw of ['', '   ', null, undefined, 42, {}]) expect(normalizeWebPageUrl(raw)).toBeNull();
  });
});

describe('canvasWebPageUrl', () => {
  it('prefers a published site over a working URL, preview and path', () => {
    expect(canvasWebPageUrl(page({ siteUrl: 'https://live.example', url: 'https://draft.example', previewUrl: 'https://preview.example' })))
      .toBe('https://live.example/');
    expect(canvasWebPageUrl(page({ url: 'https://draft.example', previewUrl: 'https://preview.example' })))
      .toBe('https://draft.example/');
    expect(canvasWebPageUrl(page({ previewUrl: 'https://preview.example' }))).toBe('https://preview.example/');
    expect(canvasWebPageUrl(page({ pathUrl: 'https://path.example' }))).toBe('https://path.example/');
  });

  it('skips a field holding something that is not a loadable address', () => {
    expect(canvasWebPageUrl(page({ siteUrl: '', url: 'javascript:alert(1)', previewUrl: 'example.com' })))
      .toBe('https://example.com/');
  });

  it('is null when the object points at nothing', () => {
    expect(canvasWebPageUrl(page({}))).toBeNull();
  });
});

describe('isWebPageKind', () => {
  it('covers the three kinds whose body IS a page', () => {
    for (const kind of ['browser', 'url', 'service'] as const) expect(isWebPageKind(kind), kind).toBe(true);
    for (const kind of ['website', 'build', 'note', 'file'] as const) expect(isWebPageKind(kind), kind).toBe(false);
  });
});

describe('webPageHost', () => {
  it('drops the www. noise and survives a non-URL', () => {
    expect(webPageHost('https://www.example.com/a/b')).toBe('example.com');
    expect(webPageHost('https://docs.example.com')).toBe('docs.example.com');
    expect(webPageHost('not a url')).toBe('not a url');
  });
});

/**
 * The viewport vocabulary is shared by every framed document on the canvas — the live
 * page panel, the app runtime, the site surface and the website card — so it is asserted
 * once, here, beside the panel that first needed it.
 */
describe('canvasViewport', () => {
  it('falls back to desktop for anything unrecognised', () => {
    expect(canvasViewport('mobile')).toBe('mobile');
    expect(canvasViewport('tablet')).toBe('tablet');
    expect(canvasViewport('watch')).toBe('desktop');
    expect(canvasViewport(undefined)).toBe('desktop');
  });

  /**
   * Three DIFFERENT widths, and a desktop that is a real width rather than "whatever the
   * panel is". The defect this guards: while `desktop` meant `null`/`100%`, the frame was
   * handed the panel's own width, so a desktop preview inside a 455px card rendered the
   * page's MOBILE layout and the three readings were indistinguishable.
   */
  it('draws each reading at a real device width, all three different', () => {
    const widths = Object.values(CANVAS_VIEWPORT_WIDTHS);
    expect(widths.every((width) => typeof width === 'number' && width > 0)).toBe(true);
    expect(new Set(widths).size).toBe(widths.length);
    expect(CANVAS_VIEWPORT_WIDTHS.desktop).toBeGreaterThan(CANVAS_VIEWPORT_WIDTHS.tablet);
    expect(CANVAS_VIEWPORT_WIDTHS.tablet).toBeGreaterThan(CANVAS_VIEWPORT_WIDTHS.mobile);
  });
});

describe('isLocalWebPageUrl', () => {
  it('recognises the dev-server addresses the gateway can never reach', () => {
    for (const url of ['http://localhost:5173/', 'http://127.0.0.1:3000', 'http://192.168.1.20:8080', 'http://10.0.0.5/', 'http://172.16.4.4/', 'http://mac.local:4000']) {
      expect(isLocalWebPageUrl(url), url).toBe(true);
    }
  });

  it('leaves public hosts — including near-misses — alone', () => {
    for (const url of ['https://example.com', 'https://172.32.1.1/', 'https://11.example.com', 'not a url']) {
      expect(isLocalWebPageUrl(url), url).toBe(false);
    }
  });
});

describe('isMixedContentFrame', () => {
  it('is true only for an http target on an https page', () => {
    expect(isMixedContentFrame('http://localhost:5173', 'https:')).toBe(true);
    expect(isMixedContentFrame('https://example.com', 'https:')).toBe(false);
    // The VS Code webview is not an https page, so the block does not apply.
    expect(isMixedContentFrame('http://localhost:5173', 'vscode-webview:')).toBe(false);
    expect(isMixedContentFrame('http://localhost:5173', 'http:')).toBe(false);
  });
});

describe('hasWebPageProbe', () => {
  it('is true only for the exact address the verdict was measured against', () => {
    const data = page({ frameCheckedUrl: 'https://example.com/' });
    expect(hasWebPageProbe(data, 'https://example.com/')).toBe(true);
    expect(hasWebPageProbe(data, 'https://other.example/')).toBe(false);
    expect(hasWebPageProbe(page({}), 'https://example.com/')).toBe(false);
  });
});
