/**
 * BuilderForce Agentic Tester runner — the long-lived process behind
 * QaRunnerContainerDO (the `qa-runner` container surface). The DO starts this
 * image and proxies `POST /run` to it.
 *
 * Flow: claim the queued exploration → establish a session (persona login for a
 * customer site, or the injected agent token for the Builderforce self-test) →
 * drive a real Chromium through the heat-derived plan, capturing console /
 * pageerror / 5xx-network / crash / assertion findings → post findings → patch
 * the run outcome. All callbacks hit the PUBLIC API authenticated by the short-
 * lived, tenant-scoped BF_AGENT_TOKEN the Worker minted (no DB creds here).
 *
 * Plain Node ESM (no build step) — this image can't import the qa-e2e TS package,
 * so it mirrors that explorer's logic here, exactly like api/container/server.mjs
 * mirrors the agent-tools verbs. Keep the two in sync when the capture rules change.
 */
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const PORT = Number(process.env.PORT || 8080);
const MAX_FINDINGS = 200;
const STEP_TIMEOUT = 8_000;
const ERROR_BOUNDARY_RE = /something went wrong|application error|unhandled runtime error|this page isn'?t working|500 internal/i;

// ── API client (Bearer = the per-run agent token) ────────────────────────────

function decodeTid(token) {
  try {
    const part = token.split('.')[1];
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json);
  } catch { return {}; }
}

function makeApi(baseUrl, token) {
  const url = (p) => `${baseUrl.replace(/\/$/, '')}${p}`;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  return {
    async post(path, body) {
      const res = await fetch(url(path), { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
      return res.json();
    },
    async patch(path, body) {
      const res = await fetch(url(path), { method: 'PATCH', headers, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`PATCH ${path} → ${res.status}`);
    },
    async get(path) {
      const res = await fetch(url(path), { headers });
      if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
      return res.json();
    },
  };
}

// ── Persona login (drive the customer site's own login form) ─────────────────

const USERNAME_SEL = 'input[type="email"], input[name*="email" i], input[name*="user" i], input[autocomplete="username"], #username, #email';
const PASSWORD_SEL = 'input[type="password"], input[name*="pass" i], #password';
const SUBMIT_SEL = 'button[type="submit"], input[type="submit"], button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Login")';

async function loginPersona(browser, baseUrl, secret) {
  const loginUrl = new URL(secret.loginUrl ?? '/login', baseUrl).toString();
  const sel = secret.loginSelectors ?? {};
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
    await page.locator(sel.usernameSelector ?? USERNAME_SEL).first().fill(secret.username);
    const pwVisible = await page.locator(sel.passwordSelector ?? PASSWORD_SEL).first().isVisible().catch(() => false);
    if (!pwVisible) {
      await page.locator(sel.submitSelector ?? SUBMIT_SEL).first().click().catch(() => {});
      await page.locator(sel.passwordSelector ?? PASSWORD_SEL).first().waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
    }
    await page.locator(sel.passwordSelector ?? PASSWORD_SEL).first().fill(secret.password);
    await page.locator(sel.submitSelector ?? SUBMIT_SEL).first().click();
    await page.waitForLoadState('networkidle').catch(() => {});
    return await context.storageState();
  } finally {
    await context.close();
  }
}

/** Self-test storageState: inject the agent token as the SPA's web+tenant token
 *  (localStorage) + cookies, so the explorer runs authenticated against the
 *  Builderforce app itself. */
function selfTestState(token, origin) {
  const { hostname } = new URL(origin);
  const claims = decodeTid(token);
  const localStorage = [
    { name: 'bf_web_token', value: token },
    { name: 'bf_tenant_token', value: token },
    { name: 'bf_user', value: JSON.stringify({ id: claims.sub ?? 'agent:qa-tester', email: 'agent@builderforce.ai' }) },
    { name: 'bf_tenant', value: JSON.stringify({ id: claims.tid ?? 0, name: 'agent' }) },
    { name: 'bf_default_tenant_id', value: String(claims.tid ?? '') },
  ];
  const cookie = (name) => ({
    name, value: token, domain: hostname, path: '/',
    expires: Math.floor(Date.now() / 1000) + 60 * 60 * 6,
    httpOnly: false, secure: hostname !== 'localhost', sameSite: 'Lax',
  });
  return { cookies: [cookie('bf_web_token'), cookie('bf_tenant_token')], origins: [{ origin, localStorage }] };
}

// ── Explorer (drive the plan, capture runtime errors) ────────────────────────

function errMsg(err) { return (err instanceof Error ? err.message : String(err)).slice(0, 400); }

async function checkHealth(page, route, heat, push) {
  if (/\/login(\b|\/|\?|$)/.test(page.url())) {
    push({ type: 'navigation', route, heat, severity: 'high', message: `redirected to /login while exploring ${route} (session/auth or guard failure)` });
    return;
  }
  try {
    const boundary = await page.getByText(ERROR_BOUNDARY_RE).count();
    if (boundary > 0) push({ type: 'pageerror', route, heat, severity: 'critical', message: `error boundary visible on ${route}` });
  } catch { /* getByText can throw mid-navigation */ }
}

async function explore(page, plan) {
  const findings = [];
  const seen = new Set();
  const ctx = { route: '/', heat: 0 };
  const push = (f) => {
    if (findings.length >= MAX_FINDINGS) return;
    const key = `${f.type}|${f.route ?? ''}|${(f.message ?? '').slice(0, 160)}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(f);
  };

  const onConsole = (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/favicon|ERR_BLOCKED_BY_CLIENT|net::ERR_/i.test(text) && !/uncaught|typeerror|referenceerror/i.test(text)) return;
    push({ type: 'console', route: ctx.route, heat: ctx.heat, message: text.slice(0, 1000) });
  };
  const onPageError = (err) => push({ type: 'pageerror', route: ctx.route, heat: ctx.heat, message: err.message.slice(0, 1000), detail: err.stack?.slice(0, 8000) ?? null });
  const onRequestFailed = (req) => {
    const failure = req.failure()?.errorText ?? 'request failed';
    if (/ERR_ABORTED/i.test(failure)) return;
    push({ type: 'network', route: ctx.route, heat: ctx.heat, message: `${req.method()} ${req.url().slice(0, 300)} — ${failure}`, detail: req.url().slice(0, 2000) });
  };
  const onResponse = (res) => {
    if (res.status() < 500) return;
    push({ type: 'network', route: ctx.route, heat: ctx.heat, message: `${res.status()} ${res.request().method()} ${res.url().slice(0, 300)}`, detail: res.url().slice(0, 2000) });
  };
  const onCrash = () => push({ type: 'crash', route: ctx.route, heat: ctx.heat, severity: 'critical', message: `page crashed at ${ctx.route}` });

  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('requestfailed', onRequestFailed);
  page.on('response', onResponse);
  page.on('crash', onCrash);

  let zonesExplored = 0;
  try {
    for (const step of plan) {
      ctx.heat = step.heat ?? 0;
      try {
        if (step.action === 'goto' && step.route) {
          ctx.route = step.route;
          const resp = await page.goto(step.route, { waitUntil: 'domcontentloaded', timeout: STEP_TIMEOUT });
          zonesExplored++;
          if (resp && resp.status() >= 400) {
            push({ type: 'navigation', route: step.route, heat: ctx.heat, severity: resp.status() >= 500 ? 'critical' : 'high', message: `navigation to ${step.route} returned HTTP ${resp.status()}` });
          }
          await checkHealth(page, step.route, ctx.heat, push);
        } else if (step.action === 'click' && step.selector) {
          zonesExplored++;
          try {
            await page.locator(step.selector).first().click({ timeout: STEP_TIMEOUT });
            await checkHealth(page, ctx.route, ctx.heat, push);
          } catch (err) {
            push({ type: 'assertion', route: ctx.route, selector: step.selector, heat: ctx.heat, message: `could not click ${step.label ?? step.selector}: ${errMsg(err)}` });
          }
        } else if (step.action === 'fill' && step.selector) {
          zonesExplored++;
          try {
            await page.locator(step.selector).first().fill(step.value ?? 'qa-probe', { timeout: STEP_TIMEOUT });
          } catch (err) {
            push({ type: 'assertion', route: ctx.route, selector: step.selector, heat: ctx.heat, message: `could not fill ${step.label ?? step.selector}: ${errMsg(err)}` });
          }
        } else if (step.action === 'expect') {
          await checkHealth(page, ctx.route, ctx.heat, push);
        } else if (step.action === 'waitFor' && step.selector) {
          await page.locator(step.selector).first().waitFor({ state: 'visible', timeout: STEP_TIMEOUT }).catch(() => {});
        } else if (step.action === 'press' && step.value) {
          await page.keyboard.press(step.value).catch(() => {});
        }
      } catch (err) {
        push({ type: 'assertion', route: ctx.route, selector: step.selector ?? null, heat: ctx.heat, message: `step '${step.action}' failed: ${errMsg(err)}` });
      }
      await page.waitForTimeout(50).catch(() => {});
    }
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
    page.off('requestfailed', onRequestFailed);
    page.off('response', onResponse);
    page.off('crash', onCrash);
  }
  return { findings, zonesExplored };
}

function outcomeStatus(findings) {
  const blocking = findings.some((f) => f.severity === 'high' || f.severity === 'critical' || ['pageerror', 'crash', 'navigation'].includes(f.type));
  return blocking ? 'failed' : 'passed';
}

function summarize(findings) {
  if (findings.length === 0) return 'No runtime errors captured across the explored hot zones.';
  const byType = new Map();
  for (const f of findings) byType.set(f.type, (byType.get(f.type) ?? 0) + 1);
  return `Captured ${findings.length} finding(s): ${[...byType.entries()].map(([t, n]) => `${n} ${t}`).join(', ')}.`;
}

// ── One exploration run ──────────────────────────────────────────────────────

async function runExploration(spec) {
  const api = makeApi(spec.apiBaseUrl, spec.agentToken);
  const bundle = await api.post('/api/qa/explorations/claim', { explorationId: spec.explorationId });
  if (!bundle.exploration) { console.log('[qa-runner] exploration not claimable (already taken or gone).'); return; }

  const explorationId = bundle.exploration.id;
  const plan = bundle.plan ?? [];
  const runBaseUrl = (bundle.target?.baseUrl ?? spec.apiBaseUrl).replace(/\/$/, '');
  if (plan.length === 0) {
    await api.patch(`/api/qa/explorations/${explorationId}`, { status: 'error', errorMessage: 'Exploration had an empty plan.', targetUrl: runBaseUrl });
    return;
  }

  // Root-in-container Chromium needs --no-sandbox; --disable-dev-shm-usage avoids
  // crashes from the container's small /dev/shm.
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    let storageState;
    if (bundle.credential) {
      const secret = await api.get(`/api/qa/credentials/${bundle.credential.id}/secret`);
      storageState = await loginPersona(browser, runBaseUrl, secret);
    } else {
      storageState = selfTestState(spec.agentToken, runBaseUrl);
    }
    const context = await browser.newContext({ baseURL: runBaseUrl, storageState });
    const page = await context.newPage();

    const { findings, zonesExplored } = await explore(page, plan);
    console.log(`[qa-runner] explored ${zonesExplored} zone(s), ${findings.length} finding(s).`);
    if (findings.length > 0) await api.post(`/api/qa/explorations/${explorationId}/findings`, { findings });
    await api.patch(`/api/qa/explorations/${explorationId}`, {
      status: outcomeStatus(findings), zonesExplored, browser: 'chromium', targetUrl: runBaseUrl, summary: summarize(findings),
    });
  } catch (err) {
    await api.patch(`/api/qa/explorations/${explorationId}`, { status: 'error', errorMessage: errMsg(err), targetUrl: runBaseUrl }).catch(() => {});
    throw err;
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
      if (!spec || !spec.explorationId || !spec.agentToken || !spec.apiBaseUrl) {
        res.writeHead(400); res.end('missing run spec fields (explorationId, agentToken, apiBaseUrl)'); return;
      }
      // Ack immediately; the run is long and self-reports to the API.
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, accepted: spec.explorationId }));
      runExploration(spec).catch((e) => console.error('[qa-runner] run crashed', e));
    });
    return;
  }
  res.writeHead(404); res.end('not found');
});

server.listen(PORT, () => console.log(`[qa-runner] container server listening on :${PORT}`));
