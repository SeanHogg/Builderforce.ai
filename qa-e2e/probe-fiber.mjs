import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0,300)));
await page.addInitScript(() => {
  window.__commits = 0; window.__report = null;
  const nearestDom = (f) => {
    const stack = [f];
    while (stack.length) {
      const n = stack.shift();
      if (n.stateNode && n.stateNode.nodeType === 1) {
        const el = n.stateNode;
        return el.tagName + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0,3).join('.') : '') + (el.id ? '#' + el.id : '');
      }
      if (n.child) stack.push(n.child);
      if (n.sibling && n !== f) stack.push(n.sibling);
    }
    return null;
  };
  const nameOf = (f) => {
    const t = f.elementType || f.type;
    if (typeof t === 'string') return t;
    if (typeof t === 'function') return t.displayName || t.name || 'anon';
    if (t && typeof t === 'object') return t.displayName || (t.render && (t.render.displayName || t.render.name)) || (t.$$typeof && String(t.$$typeof)) || 'obj';
    return String(t);
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map(), supportsFiber: true, isDisabled: false,
    inject(){return 1;},
    onCommitFiberRoot(id, root){
      window.__commits++;
      if (window.__commits !== 4000) return;
      const out = [];
      const walk = (f, depth, path) => {
        if (!f || depth > 60) return;
        const updated = (f.flags & 4) !== 0 || f.lanes !== 0;
        if (updated && depth < 60) {
          out.push({ name: nameOf(f), tag: f.tag, flags: f.flags, lanes: f.lanes, dom: nearestDom(f), path: path.slice(-8).join(' > ') });
        }
        let c = f.child;
        while (c) { walk(c, depth + 1, [...path, nameOf(f)]); c = c.sibling; }
      };
      walk(root.current, 0, []);
      window.__report = out.slice(0, 40);
    },
    onCommitFiberUnmount(){}, onPostCommitFiberRoot(){}, checkDCE(){}, on(){}, off(){}, sub(){return()=>{};}, emit(){}, getFiberRoots(){return new Set();},
  };
});
await page.goto('https://builderforce.ai/', { waitUntil: 'load' });
await page.waitForTimeout(6000);
const rep = await page.evaluate(() => window.__report);
console.log('commits', await page.evaluate(()=>window.__commits));
console.log(JSON.stringify(rep, null, 1));
await browser.close();
