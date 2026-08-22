import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.addInitScript(() => {
  window.__commits = 0; window.__out = null;
  const shape = (v, d = 0) => {
    if (v === null || v === undefined) return String(v);
    const t = typeof v;
    if (t === 'function') return 'fn';
    if (t !== 'object') return t === 'string' ? JSON.stringify(String(v).slice(0, 40)) : String(v);
    if (d > 1) return Array.isArray(v) ? `[${v.length}]` : '{…}';
    if (Array.isArray(v)) return `[${v.length}:` + v.slice(0, 3).map(x => shape(x, d + 1)).join(',') + ']';
    return '{' + Object.keys(v).slice(0, 12).map(k => k + ':' + shape(v[k], d + 1)).join(', ') + '}';
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { renderers: new Map(), supportsFiber: true, isDisabled: false, inject(){return 1;},
    onCommitFiberRoot(id, root){ window.__commits++;
      if (window.__commits !== 2500) return;
      const changed = [], stateChanged = [];
      const walk = (f, depth) => { if (!f) return;
        const alt = f.alternate;
        if (f.tag === 10 && alt && f.memoizedProps && alt.memoizedProps && f.memoizedProps.value !== alt.memoizedProps.value) {
          changed.push({ depth, value: shape(f.memoizedProps.value) });
        }
        if ((f.tag === 0 || f.tag === 1) && alt) {
          let h = f.memoizedState, ha = alt.memoizedState, i = 0, diffs = [];
          while (h && ha && i < 12) { if (h.memoizedState !== ha.memoizedState && h.queue) diffs.push(i + ':' + shape(h.memoizedState) + ' <- ' + shape(ha.memoizedState)); h = h.next; ha = ha.next; i++; }
          if (diffs.length) stateChanged.push({ depth, name: (typeof (f.elementType||f.type) === 'function' ? ((f.elementType||f.type).name || '?') : '?'), diffs, src: String(f.elementType||f.type).slice(0, 260) });
        }
        let c = f.child; while (c) { walk(c, depth + 1); c = c.sibling; } };
      walk(root.current, 0);
      window.__out = { changed: changed.slice(0, 25), stateChanged: stateChanged.slice(0, 25) };
    },
    onCommitFiberUnmount(){}, onPostCommitFiberRoot(){}, checkDCE(){}, on(){}, off(){}, sub(){return()=>{};}, emit(){}, getFiberRoots(){return new Set();} };
});
await page.goto('https://builderforce.ai/', { waitUntil: 'load' });
await page.waitForTimeout(7000);
console.log(JSON.stringify(await page.evaluate(() => window.__out), null, 1));
await browser.close();
