import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', e => console.log('PAGEERROR', String(e.stack||e).slice(0,400)));
await page.addInitScript(() => {
  window.__commits = 0; window.__stacks = [];
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map(), supportsFiber: true, isDisabled: false,
    inject(){return 1;},
    onCommitFiberRoot(id, root){ window.__commits++; if (window.__commits % 700 === 0) window.__stacks.push(new Error().stack); },
    onCommitFiberUnmount(){}, onPostCommitFiberRoot(){}, checkDCE(){}, on(){}, off(){}, sub(){return()=>{};}, emit(){}, getFiberRoots(){return new Set();},
  };
  // who is scheduling?
  window.__sched = { raf: 0, timeout: 0, msg: 0, micro: 0 };
  const raf = window.requestAnimationFrame; window.requestAnimationFrame = function(cb){ window.__sched.raf++; return raf.call(window, cb); };
  const st = window.setTimeout; window.setTimeout = function(...a){ window.__sched.timeout++; return st.apply(window, a); };
  const MC = window.MessageChannel;
  window.MessageChannel = function(){ const c = new MC(); const op = c.port2.postMessage.bind(c.port2); c.port2.postMessage = (...a)=>{ window.__sched.msg++; return op(...a); }; return c; };
});
await page.goto('https://builderforce.ai/', { waitUntil: 'load' });
await page.waitForTimeout(5000);
const r = await page.evaluate(() => ({ commits: window.__commits, sched: window.__sched, stacks: window.__stacks.slice(-3) }));
console.log('commits', r.commits, 'sched', JSON.stringify(r.sched));
r.stacks.forEach((s, i) => console.log('\n--- STACK', i, '---\n' + s.split('\n').slice(0, 22).join('\n')));
await browser.close();
