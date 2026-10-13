/**
 * `page_capture` and `page_render_after` — the page review's runner jobs (PRD 33 §5.2).
 *
 * page_capture       open ONE page at ONE size (1440×900 or 390×844), wait for the
 *                    network to settle, read it (markup with masked regions emptied,
 *                    element boxes named by THE `deriveSelector`, lab timings), take the
 *                    full and fold screenshots, and post the facts (`pageFacts.mjs`).
 * page_render_after  open the page at both sizes, apply the fix's validated patch with
 *                    THE `applyVisualPatch`, screenshot each, upload, report.
 *
 * Selector derivation and patch semantics are NOT copied here: the API names the page
 * kit bundle (`replay-sdk/src/pageKit.ts`, published to the CDN with the player) and
 * this job injects it into the page, so the rect map names elements exactly as the
 * recorder's clicks do. The page is only READ: every non-GET request is aborted, so a
 * capture can never submit a form or sign in, and nothing is clicked or typed.
 *
 * Every callback carries the job's own capability token (Bearer) — it can write this
 * one capture (or this one fix's renders), nothing else.
 */
import { captureFacts, rectMapOf } from './pageFacts.mjs';

export const PAGE_CAPTURE_JOB = 'page_capture';
export const PAGE_RENDER_JOB = 'page_render_after';
const LOAD_TIMEOUT_MS = 45_000;
const SETTLE_MS = 1_500;
const MAX_FULL_HEIGHT = 8_000;
const JPEG_QUALITY = 70;
const ELEMENTS_MAX = 800;

const isHttps = (v) => typeof v === 'string' && v.startsWith('https://');
const isViewport = (v) => v && Number.isFinite(v.w) && Number.isFinite(v.h) && v.w >= 320 && v.h >= 320 && v.w <= 2560 && v.h <= 2560;

/** A reason the capture job body is unusable, or null. */
export function validatePageCaptureJob(spec) {
  if (!spec || typeof spec !== 'object') return 'missing job body';
  for (const field of ['captureToken', 'path', 'pageKitGlobal']) if (typeof spec[field] !== 'string' || !spec[field]) return `missing ${field}`;
  for (const field of ['url', 'captureUrl', 'pageKitUrl']) if (!isHttps(spec[field])) return `${field} must be https`;
  if (spec.device !== 'desktop' && spec.device !== 'phone') return 'device must be desktop or phone';
  if (!isViewport(spec.viewport)) return 'missing viewport';
  if (!/^[A-Za-z_$][\w$]*$/.test(spec.pageKitGlobal)) return 'pageKitGlobal is not an identifier';
  return null;
}

/** A reason the render job body is unusable, or null. */
export function validatePageRenderJob(spec) {
  if (!spec || typeof spec !== 'object') return 'missing job body';
  for (const field of ['renderToken', 'prescriptionId', 'pageKitGlobal']) if (typeof spec[field] !== 'string' || !spec[field]) return `missing ${field}`;
  for (const field of ['url', 'renderUrl', 'pageKitUrl']) if (!isHttps(spec[field])) return `${field} must be https`;
  if (!spec.patch || !Array.isArray(spec.patch.ops) || spec.patch.ops.length === 0) return 'missing patch';
  if (!spec.viewports || !isViewport(spec.viewports.desktop) || !isViewport(spec.viewports.phone)) return 'missing viewports';
  if (!/^[A-Za-z_$][\w$]*$/.test(spec.pageKitGlobal)) return 'pageKitGlobal is not an identifier';
  return null;
}

const errMsg = (err) => (err instanceof Error ? err.message : String(err)).slice(0, 380);

function client(token) {
  const auth = { Authorization: `Bearer ${token}` };
  return {
    async upload(url, bytes, contentType) {
      const res = await fetch(url, { method: 'POST', headers: { ...auth, 'Content-Type': contentType }, body: bytes });
      if (!res.ok) throw new Error(`POST ${url} → ${res.status}`);
    },
    async post(url, body) {
      const res = await fetch(url, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`POST ${url} → ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    },
  };
}

/** Lab timings, observed from the first byte (buffered observers installed before any script runs). */
const PERF_INIT = `(() => {
  const s = (window.__bfPerf = { lcp: null, cls: 0, longTasks: [] });
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) s.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) s.cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) s.longTasks.push(e.duration); }).observe({ type: 'longtask', buffered: true }); } catch {}
})();`;

/** Runs IN the page: the snapshot `captureFacts` reads. `kitGlobal` names the injected page kit. */
function collectSnapshot({ kitGlobal, maxElements }) {
  const kit = window[kitGlobal];
  const MASK = '[data-bf-mask],[data-bf-block]';
  const roleOf = (el) => {
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (/^h[1-6]$/.test(tag) || role === 'heading') return 'heading';
    if (tag === 'button' || role === 'button' || (tag === 'input' && /^(submit|button)$/i.test(el.type))
      || (tag === 'a' && /\b(btn|button|cta)\b/i.test(el.className || ''))) return 'cta';
    if (tag === 'a' && el.hasAttribute('href')) return 'link';
    if ((tag === 'input' && !/^(hidden|submit|button|image|reset)$/i.test(el.type)) || tag === 'select' || tag === 'textarea') return 'input';
    if (tag === 'img') return 'image';
    if (['section', 'header', 'footer', 'nav', 'main', 'form', 'aside'].includes(tag)) return 'section';
    if (['p', 'li', 'blockquote', 'figcaption', 'label', 'dd', 'td'].includes(tag)) return 'text';
    return null;
  };
  const effectiveBg = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)|transparent/.test(bg)) return bg;
    }
    return 'rgb(255, 255, 255)';
  };
  const hasLabel = (el) => !!(el.labels && el.labels.length) || !!el.getAttribute('aria-label') || !!el.getAttribute('aria-labelledby') || !!el.getAttribute('title');
  const elements = [];
  for (const el of document.querySelectorAll('body *')) {
    if (elements.length >= maxElements) break;
    const role = roleOf(el);
    if (!role) continue;
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (box.width <= 0 || box.height <= 0 || style.visibility === 'hidden' || style.display === 'none') continue;
    const masked = !!el.closest(MASK);
    const named = kit.deriveSelector(el);
    const text = masked ? '' : (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 400);
    elements.push({
      selector: named.selector,
      label: masked ? '' : named.label,
      role,
      tag: el.tagName.toLowerCase(),
      x: box.left + window.scrollX,
      y: box.top + window.scrollY,
      w: box.width,
      h: box.height,
      text: role === 'image' || role === 'section' ? '' : text,
      masked,
      interactive: role === 'cta' || role === 'link' || role === 'input',
      fontSize: parseFloat(style.fontSize) || 16,
      fontWeight: Number(style.fontWeight) || 400,
      color: style.color,
      bg: effectiveBg(el),
      hasLabel: role === 'input' ? hasLabel(el) : true,
      alt: role === 'image' ? el.getAttribute('alt') : null,
      src: role === 'image' ? el.currentSrc || el.src || null : null,
      tabindex: el.getAttribute('tabindex'),
    });
  }
  // The markup, with every masked or blocked region emptied before it leaves the page.
  const clone = document.documentElement.cloneNode(true);
  for (const node of clone.querySelectorAll(MASK)) node.innerHTML = '';
  for (const node of clone.querySelectorAll('input,textarea')) { node.removeAttribute('value'); node.textContent = ''; }
  const nav = performance.getEntriesByType('navigation')[0];
  const perf = window.__bfPerf || {};
  return {
    html: clone.outerHTML.slice(0, 2_000_000),
    viewport: { w: window.innerWidth, h: window.innerHeight },
    elements,
    perf: {
      lcp: perf.lcp,
      cls: perf.cls,
      longTasks: perf.longTasks || [],
      navBytes: nav ? nav.transferSize || 0 : 0,
      resources: performance.getEntriesByType('resource').map((r) => ({
        name: r.name, bytes: r.transferSize || r.encodedBodySize || 0, type: r.initiatorType, renderBlocking: r.renderBlockingStatus || null,
      })),
    },
  };
}

async function openReadOnly(browser, viewport, device) {
  const context = await browser.newContext({
    viewport: { width: viewport.w, height: viewport.h },
    deviceScaleFactor: 1,
    isMobile: device === 'phone',
    hasTouch: device === 'phone',
    // The kit is injected into pages whose CSP would refuse an inline script.
    bypassCSP: true,
  });
  // READ ONLY: no form submission, no sign-in, no beacon writes.
  await context.route('**/*', (route) => {
    const method = route.request().method();
    return method === 'GET' || method === 'HEAD' ? route.continue() : route.abort();
  });
  await context.addInitScript(PERF_INIT);
  return context;
}

async function load(page, url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: LOAD_TIMEOUT_MS }).catch(async () => {
    // A page that never goes quiet (polling, analytics) is still captured once it loaded.
    await page.waitForLoadState('load', { timeout: 5_000 }).catch(() => {});
  });
  await page.waitForTimeout(SETTLE_MS);
}

async function kitSource(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`page kit ${res.status}`);
  return res.text();
}

/** One page at one size → assets + facts posted. Never throws past a log line. */
export async function runPageCapture(spec) {
  const api = client(spec.captureToken);
  let browser;
  try {
    const kit = await kitSource(spec.pageKitUrl);
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const context = await openReadOnly(browser, spec.viewport, spec.device);
    const page = await context.newPage();
    await load(page, spec.url);
    await page.addScriptTag({ content: kit });
    const snapshot = await page.evaluate(collectSnapshot, { kitGlobal: spec.pageKitGlobal, maxElements: ELEMENTS_MAX });

    const height = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => spec.viewport.h);
    const full = await page.screenshot({
      type: 'jpeg', quality: JPEG_QUALITY, fullPage: true,
      clip: { x: 0, y: 0, width: spec.viewport.w, height: Math.min(MAX_FULL_HEIGHT, Math.max(spec.viewport.h, height)) },
    });
    const fold = await page.screenshot({ type: 'jpeg', quality: JPEG_QUALITY });

    await api.upload(`${spec.captureUrl}/assets/screenshot`, full, 'image/jpeg');
    await api.upload(`${spec.captureUrl}/assets/fold`, fold, 'image/jpeg');
    await api.upload(`${spec.captureUrl}/assets/rects`, Buffer.from(JSON.stringify(rectMapOf(snapshot.elements))), 'application/json');
    await api.post(spec.captureUrl, captureFacts(snapshot, { device: spec.device, url: spec.url }));
    console.log(`[qa-runner] page_capture ${spec.path} (${spec.device}): captured`);
  } catch (err) {
    console.error(`[qa-runner] page_capture ${spec.path} (${spec.device}) failed`, errMsg(err));
  } finally {
    await browser?.close().catch(() => {});
  }
}

/** One fix's patch at both sizes → after screenshots posted. Never throws past a log line. */
export async function runPageRender(spec) {
  const api = client(spec.renderToken);
  let browser;
  const rendered = [];
  try {
    const kit = await kitSource(spec.pageKitUrl);
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    for (const device of ['desktop', 'phone']) {
      const context = await openReadOnly(browser, spec.viewports[device], device);
      try {
        const page = await context.newPage();
        await load(page, spec.url);
        await page.addScriptTag({ content: kit });
        await page.evaluate(({ kitGlobal, patch, origin }) => window[kitGlobal].applyVisualPatch(document, patch, { origin }), {
          kitGlobal: spec.pageKitGlobal, patch: spec.patch, origin: spec.origin ?? null,
        });
        await page.waitForTimeout(300);
        const shot = await page.screenshot({ type: 'jpeg', quality: JPEG_QUALITY });
        await api.upload(`${spec.renderUrl}/assets/${device}`, shot, 'image/jpeg');
        rendered.push(device);
      } finally {
        await context.close().catch(() => {});
      }
    }
  } catch (err) {
    console.error(`[qa-runner] page_render_after ${spec.prescriptionId} failed`, errMsg(err));
  } finally {
    await browser?.close().catch(() => {});
    if (rendered.length > 0) await api.post(spec.renderUrl, { devices: rendered }).catch((err) => console.error('[qa-runner] render report failed', errMsg(err)));
  }
}
