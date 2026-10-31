/**
 * BuilderForce Agent Container — the run SANDBOX. AgentContainerDO starts this image and
 * proxies requests to it; the Worker's ONE cloud engine (`cloudAgentEngine.ts`, driven by
 * CloudRunnerDO on every plan) calls it for what a Worker physically cannot do.
 *
 * It runs no agent loop and makes no model or policy decision. The engine owns the loop,
 * the tools (the SHARED `read_file` / `run_command` / `git_*` definitions), the write
 * commits, verify and finalize. This file is the HTTP transport over one clone; the
 * primitives themselves live in `sandboxCore.mjs`, which the GitHub Actions runner serves
 * over its own transport:
 *
 *   • `POST /sandbox/open`  — clone the ticket branch (falling back to base on run #1),
 *     start the clone's post-edit checks and the live preview. Idempotent per execution;
 *     a request for an execution this process has not opened answers 409 `not_open`, and
 *     the engine re-opens (a recycled container is a fresh clone of the branch, which
 *     already carries every committed write).
 *   • `POST /sandbox/fs`    — list / read / write / delete in the clone. A write the
 *     engine already COMMITTED is absorbed by fast-forwarding the clone to the ticket
 *     branch, so the shell builds against it and the git tools see it as history.
 *   • `POST /sandbox/run`   — a shell command in the clone (`cwd`: a directory inside it).
 *     Closing the request (the engine's cancel aborts its fetch) kills the command.
 *   • `POST /sandbox/job/{start,poll,kill}` — BACKGROUND commands (`sandboxJobs.mjs`): the
 *     job table lives here, so a job outlives the request that started it and is
 *     pollable on a later tick. `/sandbox/close` kills every job the run left.
 *   • `POST /sandbox/checks` — drain the post-edit checks for the edits since the last
 *     drain: the verdict the engine's loop guards fold (D1) and show the model (D7).
 *   • `POST /sandbox/close` — dispose the clone at run end.
 *
 * It also serves `POST /web-scan`: the two stages of the platform's web security scan
 * that a Worker physically cannot perform (reading the peer TLS certificate, which
 * needs a socket). Same rule as above — this process OBSERVES, the Worker decides.
 *
 * The only Worker callbacks left are the `preview` op (the Worker owns the instance
 * budget and the health probe) and timeline `event`s for its local services, both
 * authenticated by the per-run token the open spec carries.
 *
 * Plain Node ESM (no build step) — node:22 ships global fetch + the APIs used here.
 */
import { createServer, request as httpRequest } from 'node:http';
import { connect as netConnect } from 'node:net';
// The web-scan TLS stage exists precisely because a Cloudflare Worker has no socket:
// `node:tls` is what lets this process read the peer certificate the Worker cannot.
import { connect as tlsConnect } from 'node:tls';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
// THE sandbox primitives (shell, working tree, post-edit checks) — the same module the
// GitHub Actions runner inlines, so both transports serve one implementation.
import { closeSandboxBox, createSandboxBox, runShell, serveSandbox } from './sandboxCore.mjs';

const PORT = Number(process.env.PORT || 8080);
// Live-preview passthrough: when a run starts a dev server on PREVIEW_PORT, the
// Worker's preview ingress proxies `preview.builderforce.ai/<token>/*` here as
// `/__preview__/*`, which we reverse-proxy (HTTP + WebSocket/HMR) to that dev server.
// 0/unset ⇒ no preview (503), so the passthrough is inert until a run opts in.
const PREVIEW_PORT = Number(process.env.PREVIEW_PORT || 0);
const PREVIEW_PREFIX = '/__preview__';
/** Strip the `/__preview__` prefix so the dev server sees its own root paths. */
function stripPreviewPrefix(url) {
  const rest = url.slice(PREVIEW_PREFIX.length);
  return rest.startsWith('/') ? rest : `/${rest}`;
}
function isPreviewUrl(url) {
  return url === PREVIEW_PREFIX || url.startsWith(`${PREVIEW_PREFIX}/`);
}
/** Reverse-proxy a preview HTTP request to the run's dev server on PREVIEW_PORT. */
function proxyPreviewHttp(req, res) {
  if (!PREVIEW_PORT) {
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    res.end('No dev server is running for this preview.');
    return;
  }
  const path = stripPreviewPrefix(req.url) || '/';
  const upstream = httpRequest(
    { host: '127.0.0.1', port: PREVIEW_PORT, method: req.method, path,
      headers: { ...req.headers, host: `127.0.0.1:${PREVIEW_PORT}` } },
    (up) => { res.writeHead(up.statusCode || 502, up.headers); up.pipe(res); },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Preview dev server unreachable.');
  });
  req.pipe(upstream);
}

const gzipAsync = promisify(gzip);
/** Bodies at least this big are gzipped; the few ops left are small and stay plain. */
const GZIP_MIN_BYTES = 16 * 1024;

/** POST a container-op back to the Worker; returns the parsed JSON body. */
async function op(spec, body) {
  const json = JSON.stringify({ executionId: spec.executionId, token: spec.token, op: body.op, args: body.args || {} });
  // The Worker detects gzip by its magic bytes and still reads plain JSON, so small
  // ops stay plain and older images keep working.
  const compress = Buffer.byteLength(json) >= GZIP_MIN_BYTES;
  const res = await fetch(`${spec.internalBaseUrl.replace(/\/$/, '')}/api/runtime/internal/container-op`, {
    method: 'POST',
    headers: compress
      ? { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }
      : { 'Content-Type': 'application/json' },
    body: compress ? await gzipAsync(json) : json,
  });
  if (!res.ok) throw new Error(`container-op ${body.op} → ${res.status}`);
  return res.json();
}


/**
 * LIVE PREVIEW — start the project's own dev server on PREVIEW_PORT.
 *
 * The passthrough (`/__preview__/*` → `127.0.0.1:PREVIEW_PORT`) has existed since the
 * ingress landed, but nothing ever STARTED a server for it to reach, so the whole
 * preview vertical terminated in a 503. This is the missing half.
 *
 * The Worker owns every decision: whether preview is enabled at all, whether this
 * tenant has capacity, which config files to write, and which command to run. This
 * function only executes the plan it is handed — so the instance budget, the plan gate
 * and the framework detection stay reviewable in one place on the server rather than
 * drifting inside an image that ships separately.
 *
 * Entirely best-effort. A preview that cannot start must never affect the RUN: every
 * failure path reports `failed` (so the panel can say why) and returns, and the caller
 * ignores the result.
 */
async function startPreviewDevServer(spec, workdir) {
  // Ask the Worker to acquire an instance. This is where the global budget, the
  // per-tenant cap and the plan gate are applied, so a refusal here is final.
  const started = await op(spec, { op: 'preview', args: { action: 'start' } }).catch(() => null);
  if (!started || started.ok !== true) return;
  const step = started.step && typeof started.step === 'object' ? started.step : spec.preview;
  if (!step || !Array.isArray(step.candidates) || step.candidates.length === 0) {
    await op(spec, { op: 'preview', args: { action: 'failed', detail: 'no preview start plan on the wire' } }).catch(() => {});
    return;
  }

  const fail = (detail) => op(spec, { op: 'preview', args: { action: 'failed', detail } }).catch(() => {});

  // 1. Write the generated config files (Vite/Metro host tuning the project cannot know
  //    about — it has no idea it is being served through a public proxy).
  const written = [];
  for (const file of Array.isArray(step.files) ? step.files : []) {
    if (!file || typeof file.path !== 'string' || typeof file.contents !== 'string') continue;
    const abs = join(workdir, file.path);
    if (!abs.startsWith(workdir)) continue; // never escape the workspace
    try {
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, file.contents, 'utf8');
      written.push(file.path);
    } catch (e) {
      await fail(`could not write ${file.path}: ${e.message}`);
      return;
    }
  }
  // The overrides are preview plumbing, not the user's code: keep them out of anything
  // the agent stages (`git add -A`) so they can never ride into the run's PR.
  // `.git/info/exclude` is local to this clone, so the repo's own .gitignore is untouched.
  if (written.length) {
    try {
      const exclude = join(workdir, '.git', 'info', 'exclude');
      const current = await readFile(exclude, 'utf8').catch(() => '');
      const missing = written.filter((p) => !current.split('\n').includes(p));
      if (missing.length) {
        await mkdir(dirname(exclude), { recursive: true });
        await writeFile(exclude, `${current}${current && !current.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`, 'utf8');
      }
    } catch { /* not a git clone — nothing to keep clean */ }
  }

  // 2. Install dependencies when the clone has none. A fresh clone never carries
  //    node_modules, so without this every `npx vite` / `next dev` below fails on a
  //    missing module and the preview reports "exited immediately". Skipped when the
  //    agent (or a previous start) already installed.
  if (typeof step.installCommand === 'string' && step.installCommand) {
    let hasPackageJson = true;
    try { await readFile(join(workdir, 'package.json')); } catch { hasPackageJson = false; }
    let installed = true;
    try { await readdir(join(workdir, 'node_modules')); } catch { installed = false; }
    if (hasPackageJson && !installed) {
      const install = await runShell(step.installCommand, workdir);
      if (install.exitCode !== 0) {
        await fail(`dependency install failed (${step.installCommand}, exit ${install.exitCode}): ${install.output.slice(-400)}`);
        return;
      }
    }
  }

  // 3. Pick the first candidate whose marker file exists AND whose required
  //    package.json script is present. Expo projects also carry a `dev` script, so the
  //    marker alone would start the wrong server — both pieces of evidence are needed.
  let scripts = {};
  try {
    scripts = JSON.parse(await readFile(join(workdir, 'package.json'), 'utf8')).scripts ?? {};
  } catch { scripts = {}; }

  let chosen = null;
  for (const candidate of step.candidates) {
    if (!candidate || typeof candidate.command !== 'string') continue;
    if (candidate.when) {
      // ANY one of the listed markers selects it (a framework accepts several config names).
      const markers = Array.isArray(candidate.when) ? candidate.when : [candidate.when];
      let found = false;
      for (const marker of markers) {
        if (typeof marker !== 'string') continue;
        try { await readFile(join(workdir, marker)); found = true; break; } catch { /* try the next name */ }
      }
      if (!found) continue;
    }
    if (candidate.requiresScript && !scripts[candidate.requiresScript]) continue;
    chosen = candidate;
    break;
  }
  if (!chosen) {
    await fail('no dev-server command matched this project (no Expo/Vite/Next marker and no runnable dev script)');
    return;
  }

  // 4. Spawn DETACHED and unref'd: the dev server outlives this call and must not hold
  //    the sandbox request, the command timeout, or the cancel-kill handle — those belong to
  //    the agent's own shell commands. `proc.current` is deliberately NOT set.
  let child;
  try {
    child = spawn('bash', ['-lc', chosen.command], {
      cwd: workdir,
      env: { ...process.env, ...(step.env && typeof step.env === 'object' ? step.env : {}) },
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch (e) {
    await fail(`could not start the dev server: ${e.message}`);
    return;
  }

  // A command that dies immediately (missing dependency, port already bound) would
  // otherwise sit "starting" until the health check gave up; say so straight away.
  let exitedEarly = null;
  child.on('exit', (code) => { exitedEarly = code; });
  child.on('error', (e) => { exitedEarly = e.message; });

  // 5. Hand the health check back to the Worker, which probes through the REAL public
  //    path (ingress → container DO → dev server) rather than trusting localhost here —
  //    a server bound to the wrong interface answers locally and 503s publicly.
  const health = step.health && typeof step.health === 'object' ? step.health : { attempts: 20, intervalMs: 1500 };
  const attempts = Number.isFinite(health.attempts) && health.attempts > 0 ? Math.min(Math.floor(health.attempts), 60) : 20;
  const intervalMs = Number.isFinite(health.intervalMs) && health.intervalMs > 0 ? Math.min(Math.floor(health.intervalMs), 10_000) : 1_500;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (exitedEarly !== null) {
      await fail(`the dev server exited immediately (${exitedEarly}) — command: ${chosen.command}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const ready = await op(spec, { op: 'preview', args: { action: 'ready' } }).catch(() => null);
    if (ready && ready.ok === true) return;
  }
  await fail(`the dev server did not answer on port ${step.port ?? PREVIEW_PORT} within ${Math.round((attempts * intervalMs) / 1000)}s — command: ${chosen.command}`);
}

/** Post a timeline event for a local service; a missed event never affects the run. */
function localServiceEvent(spec, toolName, detail, result) {
  op(spec, { op: 'event', args: { toolName, category: 'tool', detail, result: String(result).slice(0, 300) } })
    .catch((e) => console.warn(`[container] ${toolName} event not recorded: ${e instanceof Error ? e.message : String(e)}`));
}

// ── The sandbox ─────────────────────────────────────────────────────────────

/**
 * Open sandboxes by execution id: `{ spec, workdir, checks, previewStarted }`. One
 * container instance serves one execution (`exec:<id>`), so this holds one entry in
 * practice; the map keeps a stray request for another id from touching this clone.
 */
const sandboxes = new Map();
/** In-flight opens, so two concurrent first calls clone once. */
const opening = new Map();

/** Clone the ticket's HEAD branch (prior runs' WIP), falling back to base on run #1. */
async function cloneInto(spec, workdir) {
  const { cloneUrl, headBranch, baseBranch } = spec.repo;
  // FULL clone (no `--depth`): a shallow clone hid earlier passes and had no merge-base
  // with the base branch, so `git_sync_latest` / `git diff main` could not work.
  let clone = headBranch
    ? await runShell(`git clone -b "${headBranch}" "${cloneUrl}" .`, workdir, null)
    : { exitCode: 1, output: 'no head branch' };
  let checkedOut = clone.exitCode === 0 ? headBranch : null;
  if (clone.exitCode !== 0) {
    const baseArg = baseBranch ? `-b "${baseBranch}"` : '';
    clone = await runShell(`git clone ${baseArg} "${cloneUrl}" .`, workdir, null);
    if (clone.exitCode === 0) checkedOut = baseBranch || '(default)';
  }
  return { ok: clone.exitCode === 0, branch: checkedOut, output: clone.output };
}

async function openSandbox(spec) {
  const existing = sandboxes.get(spec.executionId);
  if (existing) return { ok: true, branch: existing.branch, reused: true };
  if (!spec.repo || typeof spec.repo.cloneUrl !== 'string') return { ok: false, error: 'no repository to clone' };
  const workdir = await mkdtemp(join(tmpdir(), `bf-exec-${spec.executionId}-`));
  const cloned = await cloneInto(spec, workdir);
  if (!cloned.ok) {
    await rm(workdir, { recursive: true, force: true }).catch(() => {});
    localServiceEvent(spec, 'runtime.clone', { phase: 'failed' }, `clone failed: ${cloned.output.slice(0, 200)}`);
    return { ok: false, error: `clone failed: ${cloned.output.slice(-300)}` };
  }
  const box = createSandboxBox({ spec, workdir, branch: cloned.branch, emit: (toolName, detail, result) => localServiceEvent(spec, toolName, detail, result) });
  box.previewStarted = false;
  sandboxes.set(spec.executionId, box);
  localServiceEvent(spec, 'runtime.clone', { branch: cloned.branch, requestedHead: spec.repo.headBranch ?? null, base: spec.repo.baseBranch ?? null },
    `cloned ${spec.repo.cloneUrl.replace(/\/\/[^@]*@/, '//')} on branch ${cloned.branch}`);
  // The dev server comes up beside the run, never in front of it: fire-and-forget, and a
  // preview that never answers must not delay or fail the run.
  if (spec.preview) {
    box.previewStarted = true;
    void startPreviewDevServer(spec, workdir).catch(() => { /* reported via the preview op */ });
  }
  return { ok: true, branch: cloned.branch };
}


async function closeSandbox(executionId) {
  const box = sandboxes.get(executionId);
  if (!box) return { ok: true };
  sandboxes.delete(executionId);
  // Background jobs die with the run (a live preview is a separate process, not a job).
  await closeSandboxBox(box).catch(() => {});
  // A live preview serves out of this clone, so it outlives the run; the preview sweep
  // stops the whole instance when it goes idle.
  if (!box.previewStarted) await rm(box.workdir, { recursive: true, force: true }).catch(() => {});
  return { ok: true };
}

/** Route one `/sandbox/*` request. Every body names its execution. */
async function handleSandbox(path, body, res) {
  if (typeof body.executionId !== 'number') return [400, { ok: false, error: 'executionId is required' }];
  if (path === '/sandbox/open') {
    if (!body.token || !body.internalBaseUrl) return [400, { ok: false, error: 'missing open spec fields' }];
    let pending = opening.get(body.executionId);
    if (!pending) {
      pending = openSandbox(body).finally(() => opening.delete(body.executionId));
      opening.set(body.executionId, pending);
    }
    const opened = await pending;
    return [opened.ok ? 200 : 502, opened];
  }
  if (path === '/sandbox/close') return [200, await closeSandbox(body.executionId)];
  const box = sandboxes.get(body.executionId);
  if (!box) return [409, { ok: false, error: 'not_open' }];
  if (!['/sandbox/fs', '/sandbox/run', '/sandbox/checks', '/sandbox/job/start', '/sandbox/job/poll', '/sandbox/job/kill'].includes(path)) return [404, { ok: false, error: 'not found' }];
  // The engine aborting its fetch (a cancel) closes the connection: kill the command. The
  // RESPONSE's 'close' — the request's has already fired once its body was read, so a
  // listener on it would never hear the cancel.
  return [200, await serveSandbox(box, path, body, (kill) => { res.on('close', kill); return () => res.off('close', kill); })];
}

// ── Web-security-scan stages ─────────────────────────────────────────────────
//
// The platform's web security scan runs inside a Cloudflare Worker, and two checks a
// real external scanner performs are simply not observable from there:
//
//   • the PEER TLS CERTIFICATE — Worker `fetch` exposes no socket, so there is no
//     chain, expiry, protocol version or cipher suite to read. No Worker-side code
//     can fix that; it needs a process with `node:tls`, which is this one.
//   • the SOFTWARE FINGERPRINT surface for a CVE lookup — one plain GET, but taken
//     from a runtime with no Worker subrequest budget to spend.
//
// This container therefore OBSERVES and posts the observation back; it decides
// nothing. Every verdict ("that cipher is weak", "that certificate expires in six
// days", "that version matches CVE-…") is computed Worker-side by pure, unit-tested
// functions (api/src/application/security/tlsCertificateScan.ts and
// softwareFingerprint.ts). Judgement written here would be judgement no test could
// reach — the image ships on its own cadence and nothing in CI executes it.
//
// Auth is the same shape the rest of this file uses: a per-id HMAC minted by the
// Worker at dispatch, echoed back verbatim. The container holds no DB credentials and
// names no tenant; the Worker resolves both from the audit id.

/** Bounded body slice for fingerprinting — mirrors the Worker scan's own ceiling. */
const WEB_SCAN_BODY_LIMIT = 200_000;
/** One stage must not hold the container open: a hung TLS socket is the usual cause. */
const WEB_SCAN_TIMEOUT_MS = 15_000;

/** POST one stage result back to the Worker's ingest seam. Never throws. */
async function postWebScanStage(spec, stage, payload) {
  try {
    const res = await fetch(`${spec.internalBaseUrl.replace(/\/$/, '')}/api/security/internal/web-scan-stage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auditId: spec.auditId, token: spec.token, stage, ...payload }),
    });
    if (!res.ok) console.error(`[container] web-scan stage ${stage} ingest → ${res.status}`);
  } catch (e) {
    console.error(`[container] web-scan stage ${stage} ingest failed`, e);
  }
}

/**
 * Open a TLS connection and DESCRIBE what came back — the certificate as
 * `getPeerCertificate()` reports it plus the negotiated protocol/cipher and Node's own
 * chain-verification verdict.
 *
 * `rejectUnauthorized: false` is deliberate and is the whole point: the scanner must be
 * able to REPORT an untrusted or expired certificate, and a socket that refuses to
 * complete the handshake would give us nothing to report. The verdict is preserved
 * separately in `authorized` / `authorizationError` rather than being thrown away with
 * the connection.
 */
function describeTlsPeer(host, port) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    let socket;
    try {
      socket = tlsConnect({
        host,
        port,
        servername: host,          // SNI — without it a shared host serves the wrong cert
        rejectUnauthorized: false, // see above: we report the failure, we do not become it
        timeout: WEB_SCAN_TIMEOUT_MS,
      });
    } catch (e) {
      finish({ host, port, protocol: null, cipherName: null, cipherStandardName: null, authorized: false, authorizationError: null, certificate: null, handshakeError: e.message });
      return;
    }

    const fail = (message) => {
      try { socket.destroy(); } catch { /* already gone */ }
      finish({ host, port, protocol: null, cipherName: null, cipherStandardName: null, authorized: false, authorizationError: null, certificate: null, handshakeError: message });
    };
    socket.once('error', (e) => fail(e.message));
    socket.once('timeout', () => fail(`the TLS handshake timed out after ${WEB_SCAN_TIMEOUT_MS}ms`));

    socket.once('secureConnect', () => {
      let observation;
      try {
        const cert = socket.getPeerCertificate(false) || null;
        const cipher = socket.getCipher?.() || null;
        const hasCert = cert && Object.keys(cert).length > 0;
        observation = {
          host,
          port,
          protocol: socket.getProtocol?.() ?? null,
          cipherName: cipher?.name ?? null,
          cipherStandardName: cipher?.standardName ?? null,
          authorized: socket.authorized === true,
          authorizationError: socket.authorizationError ? String(socket.authorizationError) : null,
          certificate: hasCert ? {
            subjectCommonName: cert.subject?.CN ?? null,
            // `subjectaltname` is one comma-joined string of `DNS:name` entries; the
            // Worker-side matcher wants a list, and splitting it HERE keeps the one
            // parsing quirk of Node's API at the edge that produced it.
            subjectAltNames: String(cert.subjectaltname || '')
              .split(',')
              .map((s) => s.trim().replace(/^DNS:/i, '').toLowerCase())
              .filter(Boolean),
            issuerCommonName: cert.issuer?.CN ?? null,
            issuerOrganization: cert.issuer?.O ?? null,
            valid_from: cert.valid_from ?? '',
            valid_to: cert.valid_to ?? '',
            signatureAlgorithm: cert.sigalg ?? null,
            // Node names the curve (`asn1Curve`/`nistCurve`) only for an EC key, so its
            // presence is the type discriminator; anything else with a modulus size is
            // RSA. Guessing wrong here would apply the wrong key-size floor.
            publicKeyType: (cert.asn1Curve || cert.nistCurve) ? 'ec' : (cert.bits ? 'rsa' : null),
            publicKeyBits: typeof cert.bits === 'number' ? cert.bits : null,
            // A leaf whose issuer DN equals its subject DN signed itself. Compared on
            // the rendered DN because that is all the socket gives us for both sides.
            selfSigned: JSON.stringify(cert.subject || {}) === JSON.stringify(cert.issuer || {}),
          } : null,
          handshakeError: null,
        };
      } catch (e) {
        observation = { host, port, protocol: null, cipherName: null, cipherStandardName: null, authorized: false, authorizationError: null, certificate: null, handshakeError: `the peer certificate could not be read: ${e.message}` };
      }
      try { socket.end(); } catch { /* best effort */ }
      finish(observation);
    });
  });
}

/** GET the target and return the surfaces a version fingerprint is read from. */
async function describeFingerprintSurface(origin) {
  const res = await fetch(origin, {
    method: 'GET',
    redirect: 'follow',
    headers: { 'user-agent': 'BuilderforceSecurityScanner/1.0 (+https://builderforce.ai)' },
    signal: AbortSignal.timeout(WEB_SCAN_TIMEOUT_MS),
  });
  const headers = {};
  res.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
  let body = '';
  const ctype = (headers['content-type'] || '').toLowerCase();
  if (ctype.includes('html') || ctype === '') {
    try { body = (await res.text()).slice(0, WEB_SCAN_BODY_LIMIT); } catch { body = ''; }
  }
  return { headers, body };
}

/**
 * Run both stages for one scan and report each independently.
 *
 * Independently is the requirement: a TLS handshake that fails must not cost the CVE
 * stage its result, and neither may end as silence — a stage that throws is posted
 * back as `error`, which the Worker records as `not_run` WITH the reason. The absence
 * of a stage report is the one outcome this function must never produce, because
 * downstream it is indistinguishable from a stage that found nothing wrong.
 */
async function runWebScanStages(spec) {
  await Promise.all([
    (async () => {
      try {
        await postWebScanStage(spec, 'tls', { tls: await describeTlsPeer(spec.host, spec.port) });
      } catch (e) {
        await postWebScanStage(spec, 'tls', { error: `the TLS stage failed inside the container: ${e.message}` });
      }
    })(),
    (async () => {
      try {
        await postWebScanStage(spec, 'cve', { cve: await describeFingerprintSurface(spec.origin) });
      } catch (e) {
        await postWebScanStage(spec, 'cve', { error: `the CVE fingerprint stage failed inside the container: ${e.message}` });
      }
    })(),
  ]);
}

/** Read a request body as JSON; null when it is not JSON. */
function readJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve(null); } });
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (isPreviewUrl(req.url)) { proxyPreviewHttp(req, res); return; }
  if (req.method === 'POST' && req.url.startsWith('/sandbox/')) {
    void readJson(req).then(async (body) => {
      if (!body) { sendJson(res, 400, { ok: false, error: 'bad request' }); return; }
      try {
        const [status, out] = await handleSandbox(req.url, body, res);
        if (!res.writableEnded) sendJson(res, status, out);
      } catch (e) {
        if (!res.writableEnded) sendJson(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    });
    return;
  }
  // Web-security-scan stages (TLS peer certificate + CVE fingerprint surface).
  // Acked immediately: the stages report their own results back to the Worker's ingest
  // seam, so the Worker's dispatch never waits on a TLS handshake.
  if (req.method === 'POST' && req.url === '/web-scan') {
    void readJson(req).then((spec) => {
      if (!spec) { res.writeHead(400); res.end('bad request'); return; }
      if (typeof spec.auditId !== 'number' || !spec.token || !spec.internalBaseUrl || !spec.host || !spec.origin) {
        res.writeHead(400); res.end('missing web-scan spec fields'); return;
      }
      sendJson(res, 202, { ok: true, accepted: spec.auditId });
      runWebScanStages(spec).catch((e) => console.error('[container] runWebScanStages crashed', e));
    });
    return;
  }
  res.writeHead(404); res.end('not found');
});

// Proxy WebSocket upgrades (Vite/Metro HMR) for `/__preview__/*` to the dev server by
// re-issuing the handshake over a raw TCP socket and piping both directions.
server.on('upgrade', (req, socket, head) => {
  if (!isPreviewUrl(req.url) || !PREVIEW_PORT) { socket.destroy(); return; }
  const path = stripPreviewPrefix(req.url) || '/';
  const upstream = netConnect(PREVIEW_PORT, '127.0.0.1', () => {
    const headers = { ...req.headers, host: `127.0.0.1:${PREVIEW_PORT}` };
    const headerLines = Object.entries(headers)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
      .join('\r\n');
    upstream.write(`${req.method} ${path} HTTP/1.1\r\n${headerLines}\r\n\r\n`);
    if (head && head.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});

server.listen(PORT, () => console.log(`[builderforce-agent-container] listening on :${PORT}`));
