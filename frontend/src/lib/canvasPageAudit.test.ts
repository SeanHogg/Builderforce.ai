import { describe, it, expect } from 'vitest';
import { auditPageHtml, readAuditFindings } from './canvasPageAudit';

const CLEAN = `<!doctype html>
<html lang="en"><head>
  <title>Acme</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="/app.js" defer></script>
</head><body>
  <header><nav><a href="/">Home</a></nav></header>
  <main>
    <h1>Acme</h1>
    <h2>Pricing</h2>
    <img src="/a.png" alt="A chart" width="200" height="100">
    <form><label for="email">Email</label><input id="email" type="email"></form>
    <button>Send</button>
  </main>
</body></html>`;

const BROKEN = `<!doctype html>
<html><head>
  <meta name="viewport" content="width=device-width, user-scalable=no">
  <script src="/blocking.js"></script>
</head><body>
  <h1>One</h1><h3>Skipped a level</h3><h1>Two</h1>
  <img src="/a.png">
  <a href="/x"></a>
  <input type="text" name="q">
  <button></button>
  <iframe src="/embed"></iframe>
  <div tabindex="3">focus trap</div>
</body></html>`;

function findingFor(html: string, rule: string) {
  return auditPageHtml(html, 'https://acme.example').findings.find((item) => item.rule === rule);
}

describe('auditPageHtml — a clean page', () => {
  const audit = auditPageHtml(CLEAN, 'https://acme.example');

  it('passes and scores high', () => {
    expect(audit.passed).toBe(true);
    expect(audit.score).toBeGreaterThan(90);
    expect(audit.counts.accessibility).toBe(0);
  });

  it('does not invent failures for things that are present', () => {
    for (const rule of ['htmlLang', 'documentTitle', 'imageAlt', 'formLabel', 'buttonName', 'landmarks', 'viewportMeta']) {
      expect(findingFor(CLEAN, rule)?.count, rule).toBe(0);
    }
  });
});

describe('auditPageHtml — a broken page', () => {
  const audit = auditPageHtml(BROKEN, 'https://acme.example');

  it('fails, and fails on the rules that are actually broken', () => {
    expect(audit.passed).toBe(false);
    const failed = audit.findings.filter((item) => item.count > 0).map((item) => item.rule);
    expect(failed).toEqual(expect.arrayContaining([
      'htmlLang', 'documentTitle', 'imageAlt', 'linkText', 'formLabel', 'buttonName',
      'headingOrder', 'singleH1', 'zoomDisabled', 'iframeTitle', 'positiveTabindex',
      'landmarks', 'blockingScripts', 'imageDimensions',
    ]));
  });

  it('carries the WCAG criterion and a findable sample', () => {
    const alt = findingFor(BROKEN, 'imageAlt');
    expect(alt?.wcag).toBe('1.1.1');
    expect(alt?.sample).toContain('<img');
    expect(alt?.detail).toMatchObject({ images: 1 });
  });

  it('states the score honestly rather than clamping to a floor of comfort', () => {
    expect(audit.score).toBeLessThan(50);
  });
});

describe('auditPageHtml — what it must NOT be fooled by', () => {
  it('ignores markup inside comments and scripts', () => {
    const html = `<html lang="en"><head><title>t</title><meta name="viewport" content="width=device-width"></head><body>
      <!-- <img src="x.png"> -->
      <script>const html = '<img src="y.png">';</script>
      <main><h1>ok</h1></main></body></html>`;
    expect(findingFor(html, 'imageAlt')?.count).toBe(0);
  });

  it('accepts a link named by its image alt text', () => {
    const html = `<html lang="en"><head><title>t</title></head><body><main><a href="/"><img src="/logo.png" alt="Acme home"></a></main></body></html>`;
    expect(findingFor(html, 'linkText')?.count).toBe(0);
  });

  it('accepts an input labelled by aria-label as well as by <label for>', () => {
    const html = `<html lang="en"><head><title>t</title></head><body><main><input type="text" aria-label="Search"></main></body></html>`;
    expect(findingFor(html, 'formLabel')?.count).toBe(0);
  });

  it('does not ask a hidden or submit input for a label', () => {
    const html = `<html lang="en"><head><title>t</title></head><body><main><input type="hidden" name="csrf"><input type="submit" value="Go"></main></body></html>`;
    expect(findingFor(html, 'formLabel')?.count).toBe(0);
  });
});

describe('readAuditFindings', () => {
  it('round-trips a stored audit and drops anything unrecognisable', () => {
    const stored = [
      { rule: 'imageAlt', category: 'accessibility', severity: 'serious', count: 2, wcag: '1.1.1' },
      { nope: true },
      'garbage',
    ];
    expect(readAuditFindings(stored)).toEqual([
      { rule: 'imageAlt', category: 'accessibility', severity: 'serious', count: 2, wcag: '1.1.1' },
    ]);
  });
});
