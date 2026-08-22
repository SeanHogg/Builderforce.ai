import { chromium } from '@playwright/test';
const url = process.argv[2] || 'http://localhost:3001/';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errs = [];
page.on('console', m => { const t = m.text(); if (/error|warn|Maximum|loop|update depth/i.test(t)) errs.push(m.type() + ': ' + t.slice(0, 400)); });
page.on('pageerror', e => errs.push('PAGEERROR ' + String(e.stack||e).slice(0,600)));
await page.addInitScript(() => {
  window.__commits = 0; window.__names = {};
  const nameOf = (f) => { const t = f.elementType || f.type;
    if (typeof t === 'string') return t;
    if (typeof t === 'function') return t.displayName || t.name || 'anon';
    if (t && typeof t === 'object') return t.displayName || (t.render && t.render.name) || String(t.$$typeof || 'obj');
    return String(t); };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { renderers: new Map(), supportsFiber: true, isDisabled: false, inject(){return 1;},
    onCommitFiberRoot(id, root){ window.__commits++;
      if (window.__commits % 50 !== 0) return;
      const walk = (f, path) => { if (!f) return; const p = [...path, nameOf(f)];
        if ((f.tag === 0 || f.tag === 1 || f.tag === 15) && f.lanes !== 0) { const k = nameOf(f); window.__names[k] = (window.__names[k]||0)+1; window.__paths = window.__paths || {}; window.__paths[k] = p.slice(-14).join(' > '); }
        let c = f.child; while (c) { walk(c, p); c = c.sibling; } };
      walk(root.current, []); },
    onCommitFiberUnmount(){}, onPostCommitFiberRoot(){}, checkDCE(){}, on(){}, off(){}, sub(){return()=>{};}, emit(){}, getFiberRoots(){return new Set();} };
});
await page.goto(url, { waitUntil: 'load', timeout: 180000 });
await page.waitForTimeout(8000);
const a = await page.evaluate(() => window.__commits);
await page.waitForTimeout(3000);
const r = await page.evaluate(() => ({ c: window.__commits, names: window.__names, paths: window.__paths }));
console.log('commits', a, 'rate/s', Math.round((r.c - a)/3));
console.log('LOOPING COMPONENTS:', JSON.stringify(r.names, null, 1));
console.log('PATHS:', JSON.stringify(r.paths, null, 1));
console.log('ERRORS:\n' + errs.slice(0, 12).join('\n'));
await browser.close();
