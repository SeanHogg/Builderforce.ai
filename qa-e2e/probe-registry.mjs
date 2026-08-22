import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.addInitScript(() => {
  window.__commits = 0; window.__prev = null; window.__churn = {}; window.__samples = 0;
  const findRegistry = (root) => {
    // the provider is the fiber whose hook0 is a ref holding a Map of {action, token}
    let found = null;
    const walk = (f) => { if (!f || found) return;
      if (f.tag === 0 && f.memoizedState && f.memoizedState.memoizedState && f.memoizedState.memoizedState.current instanceof Map) {
        const m = f.memoizedState.memoizedState.current;
        const first = m.values().next().value;
        if (first && first.action && typeof first.action.name === 'string') found = m;
      }
      let c = f.child; while (c) { walk(c); c = c.sibling; } };
    walk(root.current); return found;
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { renderers: new Map(), supportsFiber: true, isDisabled: false, inject(){return 1;},
    onCommitFiberRoot(id, root){ window.__commits++;
      if (window.__commits < 1500 || window.__commits % 40 !== 0 || window.__samples > 25) return;
      const m = findRegistry(root); if (!m) return;
      window.__samples++;
      const snap = {}; for (const [k, v] of m) snap[k] = v.token;
      if (window.__prev) {
        for (const k of Object.keys(snap)) if (window.__prev[k] !== snap[k]) window.__churn[k] = (window.__churn[k]||0)+1;
        for (const k of Object.keys(window.__prev)) if (!(k in snap)) window.__churn['(removed)'+k] = (window.__churn['(removed)'+k]||0)+1;
      }
      window.__prev = snap;
      window.__allNames = Object.keys(snap);
    },
    onCommitFiberUnmount(){}, onPostCommitFiberRoot(){}, checkDCE(){}, on(){}, off(){}, sub(){return()=>{};}, emit(){}, getFiberRoots(){return new Set();} };
});
await page.goto('https://builderforce.ai/', { waitUntil: 'load' });
await page.waitForTimeout(8000);
console.log(JSON.stringify(await page.evaluate(() => ({ commits: window.__commits, samples: window.__samples, names: window.__allNames, churn: window.__churn })), null, 1));
await browser.close();
