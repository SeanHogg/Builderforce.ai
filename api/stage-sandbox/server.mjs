/**
 * Stage Sandbox runner — the long-lived process behind StageSandboxContainerDO
 * (the `stage-sandbox` container surface). The DO starts this image and
 * proxies `POST /run` to it.
 *
 * Flow: claim the queued run → drive it with a real Chromium per harness
 * (`runtime`: dispatch a touch gesture at a booted document, with every
 * outbound request from the document itself blocked; `media`: measure real
 * `loadedmetadata` duration on the buyer-facing assets) → PATCH the result
 * back. All callbacks hit the PUBLIC API authenticated by the short-lived,
 * run-scoped token the Worker minted (no DB creds here).
 *
 * Plain Node ESM (no build step) — this image can't import the api TS
 * package, so it mirrors `application/marketplace/stageChecks.ts`'s field
 * readers here, exactly like `qa-container/server.mjs` mirrors the QA
 * explorer's logic. Keep the two in sync when the capture rules change.
 */
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const PORT = Number(process.env.PORT || 8080);
const MAX_RUN_MS = 90_000;
const STEP_TIMEOUT = 8_000;

// ── API client (Bearer = the per-run agent token) ────────────────────────────

function makeApi(baseUrl, token) {
  const url = (p) => `${baseUrl.replace(/\/$/, '')}${p}`;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  return {
    async get(path) {
      const res = await fetch(url(path), { headers });
      if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
      return res.json();
    },
    async patch(path, body) {
      const res = await fetch(url(path), { method: 'PATCH', headers, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`PATCH ${path} → ${res.status}`);
    },
  };
}

function errMsg(err) { return (err instanceof Error ? err.message : String(err)).slice(0, 400); }

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ── Field readers — mirrors stageChecks.ts's `fields()`/`runnableDocument()` ─

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function fields(object) {
  return { ...record(object?.content), ...record(object?.canvasData) };
}

function runnableDocument(objects) {
  for (const object of objects) {
    const data = fields(object);
    const document = data.document ?? data.html;
    if (typeof document === 'string' && document.trim()) return document;
  }
  return null;
}

// ── `runtime` harness — boot the document and drive a touch gesture ─────────

async function driveRuntime(browser, objects) {
  const document = runnableDocument(objects);
  if (!document) return []; // nothing to drive — the caller falls back to its static reading

  const context = await browser.newContext({
    hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 },
  });
  // The play frame is sandboxed and offline for a real buyer — enforced here,
  // not merely asserted by the regex the static check falls back to. Anything
  // the document itself tries to fetch is aborted; `setContent` below never
  // triggers a main-frame request, so this only ever catches subresources.
  await context.route('**/*', (route) => route.abort());

  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('crash', () => errors.push('page crashed'));

  await page.addInitScript(() => {
    window.__stageSandboxTouch = new Set();
    const original = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function patchedAddEventListener(type, ...rest) {
      if (/touch|pointerdown|pointermove/i.test(String(type))) window.__stageSandboxTouch.add(String(type));
      return original.call(this, type, ...rest);
    };
  });

  try {
    await page.setContent(document, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT });
    await page.waitForTimeout(300);
    const box = page.viewportSize();
    if (box) {
      await page.touchscreen.tap(Math.floor(box.width / 2), Math.floor(box.height / 2)).catch(() => {});
    }
    await page.waitForTimeout(200);
    const registered = await page.evaluate(() => Array.from(window.__stageSandboxTouch ?? []));

    if (errors.length) {
      return [{
        code: 'runtime.crash', group: 'runs', severity: 'block', label: 'Threw while booting in the sandbox',
        detail: errors.slice(0, 3).join('; '),
      }];
    }
    return [registered.length
      ? { code: 'runtime.touch', group: 'runs', severity: 'pass', label: 'Registers touch input, driven and observed' }
      : {
          code: 'runtime.touch', group: 'runs', severity: 'warn', label: 'No touch input found',
          detail: 'Keyboard-only. Unplayable on a phone, which is where most buyers will open it.',
        }];
  } finally {
    await context.close();
  }
}

// ── `media` harness — measure real `loadedmetadata` duration ────────────────

async function measureMedia(browser, objects) {
  const media = objects.map(fields);
  const assets = [];
  for (const data of media) {
    if (typeof data.videoUrl === 'string' && data.videoUrl) assets.push({ url: data.videoUrl, tag: 'video' });
    if (typeof data.audioUrl === 'string' && data.audioUrl) assets.push({ url: data.audioUrl, tag: 'audio' });
  }
  if (!assets.length) return []; // nothing to measure — the caller falls back to its declared-field reading

  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const html = `<!doctype html><html><body>${assets
      .map((a, i) => `<${a.tag} id="m${i}" src="${a.url}" preload="metadata"></${a.tag}>`)
      .join('')}</body></html>`;
    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    let totalSeconds = 0;
    let failed = 0;
    for (let i = 0; i < assets.length; i++) {
      try {
        const duration = await page.evaluate((id) => new Promise((resolve, reject) => {
          const el = document.getElementById(id);
          if (!el) { reject(new Error('missing element')); return; }
          if (el.readyState >= 1 && Number.isFinite(el.duration)) { resolve(el.duration); return; }
          el.addEventListener('loadedmetadata', () => resolve(el.duration), { once: true });
          el.addEventListener('error', () => reject(new Error('media failed to load')), { once: true });
          setTimeout(() => reject(new Error('timeout')), 8000);
        }), `m${i}`);
        if (Number.isFinite(duration) && duration > 0) totalSeconds += duration; else failed++;
      } catch {
        failed++;
      }
    }

    if (totalSeconds > 0) {
      return [{ code: 'media.duration', group: 'runs', severity: 'pass', label: `Runs ${Math.round(totalSeconds)}s (measured)` }];
    }
    return [{
      code: 'media.duration', group: 'runs', severity: 'block', label: 'Nothing played',
      detail: `${failed} of ${assets.length} media asset(s) failed to load or reported no duration.`,
    }];
  } finally {
    await context.close();
  }
}

// ── One sandbox run ───────────────────────────────────────────────────────

async function runSandbox(spec) {
  const api = makeApi(spec.apiBaseUrl, spec.agentToken);
  const started = Date.now();
  const bundle = await api.get(`/api/creation-listings/sandbox/${spec.runId}/claim`);
  if (!bundle.harness) { console.log('[stage-sandbox] run not claimable (already taken or gone).'); return; }

  const objects = Array.isArray(bundle.objects) ? bundle.objects : [];
  // Root-in-container Chromium needs --no-sandbox; --disable-dev-shm-usage avoids
  // crashes from the container's small /dev/shm.
  const browser = await chromium.launch({
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
  });
  try {
    const findings = await withTimeout(
      bundle.harness === 'runtime' ? driveRuntime(browser, objects) : measureMedia(browser, objects),
      MAX_RUN_MS,
      'sandbox run',
    );
    const blocked = findings.some((f) => f.severity === 'block');
    await api.patch(`/api/creation-listings/sandbox/${spec.runId}`, {
      status: blocked ? 'failed' : 'passed',
      findings,
      summary: findings.length
        ? findings.map((f) => f.label).join('; ')
        : 'Nothing recognizable to run for this build.',
      durationMs: Date.now() - started,
    });
  } catch (err) {
    await api.patch(`/api/creation-listings/sandbox/${spec.runId}`, {
      status: 'error', errorMessage: errMsg(err), durationMs: Date.now() - started,
    }).catch(() => {});
  } finally {
    await browser.close();
  }
}

// ── HTTP server (the DO control plane talks to this) ─────────────────────────

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method === 'POST' && req.url === '/run') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let spec;
      try { spec = JSON.parse(raw); } catch { res.writeHead(400); res.end('bad request'); return; }
      if (!spec || !spec.runId || !spec.agentToken || !spec.apiBaseUrl) {
        res.writeHead(400); res.end('missing run spec fields (runId, agentToken, apiBaseUrl)'); return;
      }
      // Ack immediately; the run is bounded (MAX_RUN_MS) and self-reports to the API.
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, accepted: spec.runId }));
      runSandbox(spec).catch((e) => console.error('[stage-sandbox] run crashed', e));
    });
    return;
  }
  res.writeHead(404); res.end('not found');
});

server.listen(PORT, () => console.log(`[stage-sandbox] container server listening on :${PORT}`));
