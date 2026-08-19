/**
 * Hydrate the real dev-build page inside jsdom and print React's own hydration
 * diagnosis. The deployed bundle is minified (error #418 names nothing); the dev
 * bundle prints the element and the diff.
 */
import { JSDOM, VirtualConsole } from 'jsdom';
import { ReadableStream, WritableStream, TransformStream } from 'node:stream/web';
import { TextEncoder, TextDecoder } from 'node:util';

const url = process.argv[2] ?? 'http://localhost:3111/create/local-hydration-probe';
const seen = [];
const vc = new VirtualConsole();
vc.on('error', (...a) => seen.push(['error', a.map(String).join(' ')]));
vc.on('warn', (...a) => seen.push(['warn', a.map(String).join(' ')]));
vc.on('jsdomError', (e) => seen.push(['jsdomError', e.message]));
vc.on('log', (...a) => seen.push(['log', a.map(String).join(' ')]));
vc.on('info', (...a) => seen.push(['info', a.map(String).join(' ')]));

const dom = await JSDOM.fromURL(url, {
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
    // jsdom ships none of the platform streams/encoders the Next client bundle
    // touches on boot; without them it throws before React ever hydrates.
    window.ReadableStream ||= ReadableStream;
    window.WritableStream ||= WritableStream;
    window.TransformStream ||= TransformStream;
    window.TextEncoder ||= TextEncoder;
    window.TextDecoder ||= TextDecoder;
    window.fetch ||= globalThis.fetch;
    window.Headers ||= globalThis.Headers;
    window.Request ||= globalThis.Request;
    window.Response ||= globalThis.Response;
    window.structuredClone ||= globalThis.structuredClone;
    window.crypto ||= globalThis.crypto;
    if (!window.crypto.randomUUID) window.crypto.randomUUID = () => globalThis.crypto.randomUUID();
    window.matchMedia = window.matchMedia || ((q) => ({
      matches: false, media: q, onchange: null,
      addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
    }));
    class RO { observe() {} unobserve() {} disconnect() {} }
    window.ResizeObserver = window.ResizeObserver || RO;
    window.IntersectionObserver = window.IntersectionObserver || class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
    window.scrollTo = window.scrollTo || (() => {});
    if (!window.HTMLCanvasElement.prototype.getContext) window.HTMLCanvasElement.prototype.getContext = () => null;
  },
});

await new Promise((r) => setTimeout(r, Number(process.argv[3] ?? 25000)));

const doc = dom.window.document;
console.log('elements after wait:', doc.querySelectorAll('*').length);
console.log('react root marker  :', !!doc.querySelector('#__next, [data-reactroot], main'));
console.log('client-only chrome :', !!doc.querySelector('[data-testid="canvas-command-bar"], [aria-label="More session actions"]'));
console.log('console lines seen :', seen.length);
const probe = doc.querySelector('#__next') ?? doc.body;
const fiberKey = Object.keys(probe).find((k) => k.startsWith('__react'));
console.log('react fiber on root:', fiberKey ?? 'NONE — React never mounted');
console.log('body text sample   :', (doc.body.textContent ?? '').replace(/\s+/g, ' ').slice(0, 200));

const hydration = seen.filter(([, m]) => /hydrat|did not match|server rendered|418|425|423/i.test(m));
console.log('--- hydration-related console output ---');
if (!hydration.length) console.log('(none)');
for (const [level, m] of hydration) console.log(`[${level}] ${m.slice(0, 4000)}\n`);
console.log('--- other console errors (first 8) ---');
for (const [level, m] of seen.filter((row) => !hydration.includes(row) && !/Could not parse CSS/.test(row[1])).slice(0, 25)) console.log(`[${level}] ${m.slice(0, 400)}`);
dom.window.close();
