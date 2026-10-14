/**
 * The pure half of the `page_capture` job (PRD 33 §5.2): SEO facts from fixture HTML,
 * content / a11y / lab facts and the rect map from fixture element lists, and the job
 * body validators. Plain `node --test`; the browser half needs Chromium.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  a11yFacts,
  captureFacts,
  contentFacts,
  contrastRatio,
  labPerfFacts,
  paletteOf,
  parseColour,
  readabilityGrade,
  rectMapOf,
  seoFacts,
} from './pageFacts.mjs';
import { validatePageCaptureJob, validatePageRenderJob } from './pageCapture.mjs';

const HTML = `<!doctype html><html><head>
<title>Acme Shoes — Fast delivery across Europe</title>
<meta name="description" content="Shoes that last: free delivery, 100-day returns and a lifetime sole guarantee on every pair.">
<link rel="canonical" href="https://shop.example/pricing">
<link rel="alternate" hreflang="de" href="https://shop.example/de/pricing">
<meta property="og:title" content="Acme"><meta property="og:image" content="https://shop.example/og.png">
<meta name="twitter:card" content="summary">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization"},{"@type":["Product","Thing"]}]}</script>
<script>var secret = "do not count me";</script>
</head><body>
<h1>Shoes that last</h1><h3>Skipped a level</h3><h1>Second h1</h1>
<p>Walk further in shoes built to last.</p>
<img src="/hero.jpg" alt="Hero shoe"><img src="/x.png">
<a href="/about">About</a><a href="https://elsewhere.example/">Out</a><a href="#top">Top</a><a href="mailto:a@b.c">Mail</a>
</body></html>`;

test('seoFacts reads the markup', () => {
  const seo = seoFacts(HTML, 'https://shop.example/pricing');
  assert.equal(seo.title, 'Acme Shoes — Fast delivery across Europe');
  assert.equal(seo.titleLength, 40);
  assert.equal(seo.metaDescriptionLength, seo.metaDescription.length);
  assert.equal(seo.canonical, 'https://shop.example/pricing');
  assert.equal(seo.indexable, true);
  assert.equal(seo.h1Count, 2);
  assert.deepEqual(seo.headingLevels, [1, 3, 1]);
  assert.equal(seo.headingOrderOk, false);
  assert.deepEqual(seo.og, { title: true, description: false, image: true });
  assert.equal(seo.twitterCard, true);
  assert.deepEqual(seo.structuredDataTypes.sort(), ['Organization', 'Product', 'Thing']);
  assert.equal(seo.imageCount, 2);
  assert.equal(seo.imagesWithAlt, 1);
  assert.equal(seo.internalLinks, 1);
  assert.equal(seo.externalLinks, 1);
  assert.deepEqual(seo.hreflang, ['de']);
  // Script text is not page copy.
  assert.ok(seo.wordCount > 10 && seo.wordCount < 40);
});

test('seoFacts: a noindex page, and a page without a title', () => {
  const seo = seoFacts('<html><head><meta name="robots" content="noindex,follow"></head><body><p>x</p></body></html>', 'https://a.example/');
  assert.equal(seo.indexable, false);
  assert.equal(seo.title, null);
  assert.equal(seo.titleLength, 0);
  assert.deepEqual(seo.structuredDataTypes, []);
});

const el = (over) => ({
  selector: 'x', label: '', role: 'text', tag: 'p', x: 0, y: 0, w: 100, h: 20, text: '', masked: false, interactive: false,
  fontSize: 16, fontWeight: 400, color: 'rgb(17, 17, 17)', bg: 'rgb(255, 255, 255)', hasLabel: true, alt: null, src: null, tabindex: null,
  ...over,
});

const ELEMENTS = [
  el({ selector: 'getByRole("heading", { name: "Shoes that last a lifetime" })', label: 'Shoes that last a lifetime', role: 'heading', tag: 'h1', text: 'Shoes that last a lifetime', y: 40 }),
  el({ selector: 'getByText("Walk further")', text: 'Walk further. Rated 4.8 out of 5 by 2,000 customers.', y: 120 }),
  el({ selector: 'getByTestId("card")', label: 'Card 4242', role: 'input', tag: 'input', text: 'Jane Doe 4242', masked: true, y: 200, hasLabel: false, interactive: true }),
  el({ selector: 'getByRole("button", { name: "Learn more" })', label: 'Learn more', role: 'cta', tag: 'button', text: 'Learn more', y: 300, w: 80, h: 30, interactive: true, color: 'rgb(170, 170, 170)' }),
  el({ selector: 'getByRole("link", { name: "Pricing" })', label: 'Pricing', role: 'link', tag: 'a', text: 'Pricing', y: 1500, interactive: true }),
  el({ selector: 'img.hero', role: 'image', tag: 'img', y: 60, w: 600, h: 400, alt: null, src: 'https://shop.example/hero.jpg' }),
  el({ selector: 'section.main', role: 'section', tag: 'section', y: 0, w: 1440, h: 2000 }),
];

test('contentFacts: above-the-fold text without masked regions, CTAs, trust signals', () => {
  const c = contentFacts(ELEMENTS, { foldHeight: 900 });
  assert.ok(c.aboveFoldText.includes('Shoes that last a lifetime'));
  assert.ok(!c.aboveFoldText.includes('Jane Doe'));
  assert.ok(!c.aboveFoldText.includes('4242'));
  assert.equal(c.valuePropAboveFold, true);
  assert.deepEqual(c.ctaLabels, ['Learn more']);
  assert.equal(c.ctaCount, 1);
  assert.equal(c.ctaAboveFold, 1);
  assert.equal(c.formFields, 1);
  assert.ok(c.trustSignals.includes('rating'));
  assert.ok(c.trustSignals.includes('stats'));
  assert.ok(c.palette.includes('#ffffff'));
});

test('a11yFacts: contrast, tap targets on the phone only, labels, alt, focus order', () => {
  const phone = a11yFacts([...ELEMENTS, el({ selector: 't', tabindex: '3' })], { device: 'phone' });
  assert.deepEqual(phone.contrastFailures.map((f) => f.selector), ['getByRole("button", { name: "Learn more" })']);
  assert.ok(phone.smallTapTargets.some((t) => t.selector === 'getByRole("button", { name: "Learn more" })'));
  assert.deepEqual(phone.missingLabels, [{ selector: 'getByTestId("card")' }]);
  assert.deepEqual(phone.missingAlt, [{ selector: 'img.hero' }]);
  assert.equal(phone.focusOrderIssues, 1);
  assert.deepEqual(a11yFacts(ELEMENTS, { device: 'desktop' }).smallTapTargets, []);
});

test('labPerfFacts: timings, weight, the largest image and whether it is above the fold', () => {
  const lab = labPerfFacts({
    lcp: 2_345.6, cls: 0.123, longTasks: [120, 40, 250], navBytes: 10_000,
    resources: [
      { name: 'https://shop.example/hero.jpg', bytes: 900_000, type: 'img', renderBlocking: null },
      { name: 'https://shop.example/app.css', bytes: 50_000, type: 'link', renderBlocking: 'blocking' },
    ],
  }, ELEMENTS, { foldHeight: 900 });
  assert.equal(lab.lcpMs, 2346);
  assert.equal(lab.cls, 123);
  assert.equal(lab.tbtMs, 70 + 200);
  assert.equal(lab.pageWeightBytes, 960_000);
  assert.equal(lab.requestCount, 3);
  assert.deepEqual(lab.largestImages[0], { url: 'https://shop.example/hero.jpg', bytes: 900_000, selector: 'img.hero', aboveFold: true });
  assert.deepEqual(lab.renderBlocking, ['https://shop.example/app.css']);
});

test('rectMapOf keeps the six roles, one per selector, with masked labels emptied', () => {
  const rects = rectMapOf(ELEMENTS);
  assert.deepEqual(rects.map((r) => r.role).sort(), ['cta', 'heading', 'image', 'input', 'link', 'section']);
  assert.equal(rects.find((r) => r.role === 'input').label, '');
});

test('colour helpers', () => {
  assert.deepEqual(parseColour('#fff'), [255, 255, 255, 1]);
  assert.deepEqual(parseColour('rgba(0, 0, 0, 0.5)'), [0, 0, 0, 0.5]);
  assert.equal(Math.round(contrastRatio([0, 0, 0], [255, 255, 255])), 21);
  assert.deepEqual(paletteOf([el({}), el({})]), ['#111111', '#ffffff']);
});

test('readabilityGrade: null on short text, higher for long words', () => {
  assert.equal(readabilityGrade('Too short.'), null);
  const simple = Array(10).fill('The cat sat on the mat.').join(' ');
  const dense = Array(10).fill('Organisational interoperability necessitates comprehensive institutional coordination.').join(' ');
  assert.ok(readabilityGrade(dense) > readabilityGrade(simple));
});

test('captureFacts assembles all four groups', () => {
  const facts = captureFacts({ html: HTML, viewport: { w: 390, h: 844 }, elements: ELEMENTS, perf: {} }, { device: 'phone', url: 'https://shop.example/pricing' });
  assert.deepEqual(Object.keys(facts).sort(), ['a11y', 'content', 'labPerf', 'seo']);
  assert.equal(facts.labPerf.lcpMs, null);
});

test('job validators', () => {
  const capture = {
    captureToken: 't', path: '/pricing', url: 'https://shop.example/pricing', device: 'phone', viewport: { w: 390, h: 844 },
    captureUrl: 'https://api.test/api/replay/page-runner/capture', pageKitUrl: 'https://cdn.test/replay/r/pagekit.abc.js', pageKitGlobal: 'BuilderforcePageKit',
  };
  assert.equal(validatePageCaptureJob(capture), null);
  assert.equal(validatePageCaptureJob({ ...capture, url: 'http://shop.example/' }), 'url must be https');
  assert.equal(validatePageCaptureJob({ ...capture, device: 'tablet' }), 'device must be desktop or phone');
  const render = {
    renderToken: 't', prescriptionId: 'p1', url: 'https://shop.example/pricing', renderUrl: 'https://api.test/api/replay/page-runner/render/p1',
    pageKitUrl: 'https://cdn.test/k.js', pageKitGlobal: 'BuilderforcePageKit', patch: { ops: [{ op: 'hide', selector: 'a' }] },
    viewports: { desktop: { w: 1440, h: 900 }, phone: { w: 390, h: 844 } },
  };
  assert.equal(validatePageRenderJob(render), null);
  assert.equal(validatePageRenderJob({ ...render, patch: { ops: [] } }), 'missing patch');
});
