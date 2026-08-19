/**
 * Hydrate the real dev-build page inside jsdom and print React's own hydration
 * diagnosis. The deployed bundle is minified (error #418 names nothing); the dev
 * bundle prints the element and the diff.
 */
import { JSDOM, VirtualConsole } from 'jsdom';

const url = process.argv[2] ?? 'http://localhost:3111/create/local-hydration-probe';
const seen = [];
const vc = new VirtualConsole();
vc.on('error', (...a) => seen.push(['error', a.map(String).join(' ')]));
vc.on('warn', (...a) => seen.push(['warn', a.map(String).join(' ')]));
vc.on('jsdomError', (e) => seen.push(['jsdomError', e.message]));

const dom = await JSDOM.fromURL(url, {
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
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

const hydration = seen.filter(([, m]) => /hydrat|did not match|server rendered|418|425|423/i.test(m));
console.log('--- hydration-related console output ---');
if (!hydration.length) console.log('(none)');
for (const [level, m] of hydration) console.log(`[${level}] ${m.slice(0, 4000)}\n`);
console.log('--- other console errors (first 8) ---');
for (const [level, m] of seen.filter((s) => !hydration.includes(s)).slice(0, 8)) console.log(`[${level}] ${m.slice(0, 300)}`);
dom.window.close();
