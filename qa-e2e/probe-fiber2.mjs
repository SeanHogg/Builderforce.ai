import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.addInitScript(() => {
  window.__commits = 0; window.__report = null;
  const nameOf = (f) => { const t = f.elementType || f.type;
    if (typeof t === 'string') return t;
    if (typeof t === 'function') return (t.displayName || t.name || 'anon') + '()';
    if (t && typeof t === 'object') return t.displayName || (t.render && (t.render.name)) || String(t.$$typeof || 'obj');
    return String(t); };
  const brief = (v, d) => { d = d || 0;
    if (v === null || v === undefined) return String(v);
    const t = typeof v;
    if (t === 'function') return 'fn:' + (v.name || '?');
    if (t !== 'object') return t === 'string' ? JSON.stringify(v.slice(0,60)) : String(v);
    if (d > 1) return Array.isArray(v) ? `[${v.length}]` : '{…}';
    if (Array.isArray(v)) return '[' + v.slice(0,6).map(x => brief(x, d+1)).join(',') + ']';
    return '{' + Object.keys(v).slice(0,8).map(k => k + ':' + brief(v[k], d+1)).join(',') + '}';
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map(), supportsFiber: true, isDisabled: false, inject(){return 1;},
    onCommitFiberRoot(id, root){
      window.__commits++;
      if (window.__commits !== 3000) return;
      const found = [];
      const walk = (f, path) => {
        if (!f) return;
        const p = [...path, nameOf(f)];
        if (f.tag === 0 && f.lanes !== 0) {
          const hooks = []; let h = f.memoizedState, i = 0;
          while (h && i < 14) { hooks.push({ i, state: brief(h.memoizedState), hasQueue: !!h.queue, deps: h.memoizedState && h.memoizedState.deps ? brief(h.memoizedState.deps) : undefined }); h = h.next; i++; }
          const kids = []; let c = f.child; while (c && kids.length < 8) { kids.push(nameOf(c)); c = c.sibling; }
          found.push({ name: nameOf(f), lanes: f.lanes, path: p.join(' > '), hooks, kids, src: (typeof (f.elementType||f.type) === 'function') ? String(f.elementType||f.type).slice(0, 500) : null });
        }
        let c = f.child; while (c) { walk(c, p); c = c.sibling; }
      };
      walk(root.current, []);
      window.__report = found.slice(0, 6);
    },
    onCommitFiberUnmount(){}, onPostCommitFiberRoot(){}, checkDCE(){}, on(){}, off(){}, sub(){return()=>{};}, emit(){return;}, getFiberRoots(){return new Set();},
  };
});
await page.goto('https://builderforce.ai/', { waitUntil: 'load' });
await page.waitForTimeout(6000);
console.log(JSON.stringify(await page.evaluate(() => window.__report), null, 1));
await browser.close();
