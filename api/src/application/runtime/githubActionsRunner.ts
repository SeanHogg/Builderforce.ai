/**
 * The run SANDBOX on a GitHub Actions runner — the executable half of the "GitHub
 * Actions" execution surface (`githubActionsWorkflow.ts` is the committed half that
 * fetches and starts it).
 *
 * It runs no agent loop. Every cloud run, on every surface, runs ONE engine
 * (`cloudAgentEngine.ts`, ticked by the run's CloudRunnerDO); this runner is that run's
 * sandbox — its shell and working tree — exactly as the Cloudflare Container is for a
 * run without Actions. The primitives are the SAME code: `container/sandboxCore.mjs`,
 * inlined below from the generated `sandboxCoreSource.ts`. Only the transport differs:
 *
 *  1. PULL, not push. Nobody can call into a GitHub runner, so it long-polls the run's
 *     durable runner for the engine's next sandbox request (`sandbox_next`), serves it,
 *     and posts the result (`sandbox_result`) — `sandbox/sandboxMailbox.ts`.
 *
 *  2. OIDC, not HMAC. A tenant repo holds no secret of ours, so the runner authenticates
 *     with the short-lived GitHub OIDC token the workflow minted — `Authorization:
 *     Bearer` on every op, verified against GitHub's JWKS (`githubOidc.ts`). That token
 *     expires (the verifier enforces `exp`), so a long run re-mints it from the Actions
 *     token endpoint before it lapses, and once more on a 401.
 *
 *  3. NO CLONE. `actions/checkout` already ran, so the working tree exists before we do.
 *     The engine's commits land on the ticket branch through the Worker's git provider;
 *     the sandbox fast-forwards this checkout to absorb them.
 *
 * Emitted as a string rather than shipped as a file so the route can serve it with no
 * build step and no asset pipeline. Plain Node ESM with NO npm dependencies — node
 * builtins plus global fetch — because it is downloaded into a bare checkout where
 * `npm install` may not have run.
 */

import { SANDBOX_CORE_IMPORTS, SANDBOX_CORE_INLINE, WORKSPACE_AGENT_SOURCE } from './generated/sandboxCoreSource';
import { BUILDERFORCE_AGENT_OIDC_AUDIENCE } from './githubActionsWorkflow';

/**
 * Render the runner script served at `/api/runtime/github-actions/runner.mjs`.
 *
 * Kept as a plain template string: what you read here is byte-for-byte what executes.
 */
export function renderAgentRunnerScript(): string {
  return `/**
 * Builderforce run sandbox (GitHub Actions surface) — served by Builderforce, downloaded
 * and executed by .github/workflows/builderforce-agent.yml. It runs no agent loop: it
 * serves the run's shell and working tree to the Builderforce engine, which drives the run.
 *
 *   POST $BUILDERFORCE_API/api/runtime/github-actions/op
 *   Authorization: Bearer <GitHub OIDC token>
 *   { executionId, op, args }
 */
${SANDBOX_CORE_IMPORTS}

const API = String(process.env.BUILDERFORCE_API || '').replace(/\\/$/, '');
let TOKEN = process.env.BUILDERFORCE_TOKEN || '';
const EXECUTION_ID = Number(process.env.BUILDERFORCE_EXECUTION_ID || 0);

/** The checkout actions/checkout produced. We never clone; this already exists. */
const WORKDIR = process.cwd();
/** How often a running command asks whether the run was cancelled. */
const CANCEL_POLL_MS = 15 * 1000;

if (!API || !TOKEN || !EXECUTION_ID) {
  console.error('[bf-runner] missing BUILDERFORCE_API / BUILDERFORCE_TOKEN / BUILDERFORCE_EXECUTION_ID');
  process.exit(1);
}

/** Where the Actions runtime mints a fresh OIDC token (set when the job has id-token: write). */
const ID_TOKEN_URL = process.env.ACTIONS_ID_TOKEN_REQUEST_URL || '';
const ID_TOKEN_REQUEST_TOKEN = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN || '';
/** The audience /op demands (a deploy token must not drive a run). */
const AUDIENCE = '${BUILDERFORCE_AGENT_OIDC_AUDIENCE}';
/** Re-mint this long before the token's \`exp\`; /op tolerates only 60s past it. */
const TOKEN_REFRESH_SKEW_MS = 2 * 60 * 1000;

/** A JWT's expiry in epoch ms (0 when it cannot be read). */
function tokenExpiryMs(jwt) {
  try { return Number(JSON.parse(Buffer.from(String(jwt).split('.')[1], 'base64url').toString('utf8')).exp) * 1000 || 0; } catch { return 0; }
}
let tokenExpiresAt = tokenExpiryMs(TOKEN);
let refreshing = null;

/** Mint a fresh OIDC token. One request at a time: concurrent ops share it. False when
 *  the runner has no way to mint one or the mint failed. */
function refreshToken() {
  if (!ID_TOKEN_URL || !ID_TOKEN_REQUEST_TOKEN) return Promise.resolve(false);
  refreshing ??= (async () => {
    try {
      const res = await fetch(ID_TOKEN_URL + '&audience=' + encodeURIComponent(AUDIENCE), { headers: { Authorization: 'bearer ' + ID_TOKEN_REQUEST_TOKEN } });
      const body = res.ok ? await res.json() : null;
      if (!body || typeof body.value !== 'string' || !body.value) return false;
      TOKEN = body.value;
      tokenExpiresAt = tokenExpiryMs(TOKEN);
      return true;
    } catch (error) {
      console.error('[bf-runner] token refresh failed', error);
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

function post(name, args) {
  return fetch(API + '/api/runtime/github-actions/op', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify({ executionId: EXECUTION_ID, op: name, args: args || {} }),
  });
}

/** POST an op back to the Worker; returns the parsed JSON body. The token is renewed
 *  ahead of its expiry, and once on a 401 (a clock-skewed or already-lapsed one). */
async function op(name, args) {
  if (tokenExpiresAt && Date.now() > tokenExpiresAt - TOKEN_REFRESH_SKEW_MS) await refreshToken();
  let res = await post(name, args);
  if (res.status === 401 && await refreshToken()) res = await post(name, args);
  if (!res.ok) throw new Error('op ' + name + ' -> ' + res.status);
  return res.json();
}

// ── THE sandbox primitives ───────────────────────────────────────────────────
// Inlined VERBATIM from api/container/sandboxCore.mjs (with the tool-output policy and
// the post-edit checks it imports) — the same module the Cloudflare Container serves, so
// both transports run one implementation. \`check:sandbox-core\` fails the build if this
// copy drifts from it.
${SANDBOX_CORE_INLINE}

/** While a command runs, a cancel of the run kills it instead of waiting it out. */
function cancelWatch(kill) {
  const timer = setInterval(() => {
    op('sandbox_status', {})
      .then((r) => { if (r && r.cancelled) kill(); })
      .catch((error) => console.error('[bf-runner] cancel poll failed; next interval will retry', error));
  }, CANCEL_POLL_MS);
  return () => clearInterval(timer);
}

/** The unprivileged user every model-run shell runs as: its own group, no sudo, and it owns the checkout while the run lasts. */
const SHELL_USER = 'bfagent';

/** The workspace helper (api/container/workspaceAgent.mjs, verbatim): the only code that touches the checkout, run as the shell user. */
const WORKSPACE_AGENT_SOURCE = ${JSON.stringify(WORKSPACE_AGENT_SOURCE)};

/**
 * BEFORE any request is served. (1) A checkout made by an older tenant workflow (no \`persist-credentials: false\`)
 * holds the job's GITHUB_TOKEN in .git/config: remove it. (2) The model's shell must not share this process's uid (it
 * would read /proc/<pid>/environ — BUILDERFORCE_TOKEN and the OIDC request token — or /proc/<pid>/mem), so create the
 * sudo-less shell user with its own group, hand it the checkout, and PROVE it is isolated. All of it fails CLOSED.
 */
async function isolateShell() {
  const scrubbed = await scrubCheckoutCredentials(WORKDIR);
  if (!scrubbed.ok) throw new Error('could not remove the persisted checkout credential: ' + String(scrubbed.output || '').trim().slice(0, 300));
  provisionShellUser({ user: SHELL_USER, workdir: WORKDIR });
  process.env.BUILDERFORCE_SHELL_USER = SHELL_USER;
  // One run owns this machine: at the end every process the shell user owns is swept (the container never does).
  process.env.BUILDERFORCE_SHELL_SWEEP = '1';
}

/** The helper script in a directory only this process can write, readable by the shell user. */
async function writeWorkspaceHelper() {
  const dir = await mkdtemp(join(tmpdir(), 'bf-helper-'));
  await chmod(dir, 0o755);
  const file = join(dir, 'workspaceAgent.mjs');
  await writeFile(file, WORKSPACE_AGENT_SOURCE, { mode: 0o644 });
  return file;
}

async function serve() {
  let isolated = false;
  let box = null;
  try {
    try {
      await isolateShell();
      isolated = true;
    } catch (e) {
      // Say WHY before exiting, so the engine is not left waiting out its own timeout for a runner that is already gone.
      const reason = e instanceof Error ? e.message : String(e);
      await op('event', { toolName: 'runtime.isolation', category: 'planning', detail: { phase: 'failed' }, result: ('the run shell could not be isolated: ' + reason).slice(0, 300) })
        .catch((error) => console.error('[bf-runner] isolation failure not reported', error));
      throw e;
    }
    const helperPath = await writeWorkspaceHelper();
    const spec = await op('spec', {});
    if (!spec || spec.error) throw new Error('could not load the sandbox spec: ' + ((spec && spec.error) || 'unknown'));
    box = createSandboxBox({
      spec,
      workdir: WORKDIR,
      helperPath,
      branch: (spec.repo && spec.repo.headBranch) || null,
      jobIdPrefix: bootJobIdPrefix(),
      emit: (toolName, detail, result) => {
        op('event', { toolName, category: 'tool', detail, result: String(result).slice(0, 300) })
          .catch((error) => console.error('[bf-runner] ' + toolName + ' event not recorded', error));
      },
    });
    await op('event', {
      toolName: 'runtime.checkout', category: 'planning',
      detail: { workdir: WORKDIR, branch: box.branch },
      result: 'serving the run sandbox from the GitHub Actions checkout at ' + WORKDIR,
    }).catch((error) => console.error('[bf-runner] checkout telemetry failed', error));

    // Serve until the run releases us (finished, cancelled, or parked on a question).
    for (;;) {
      const next = await op('sandbox_next', {});
      if (!next || next.close) return;
      if (!next.request) continue;
      const { id, path, body } = next.request;
      let result;
      try {
        result = await serveSandbox(box, path, body || {}, cancelWatch);
      } catch (e) {
        result = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      await op('sandbox_result', { id, result }).catch((error) => console.error('[bf-runner] result not delivered', error));
    }
  } finally {
    // However it ends: the run's background jobs and helper end with it, every process the shell user owns is swept,
    // and the checkout goes back to the runner WITHOUT its .git (shell-written config and hooks must never be run by
    // the job's later steps, such as actions/checkout's post step).
    if (box) await closeSandboxBox(box);
    if (isolated) {
      await sweepShellProcesses();
      try {
        releaseShellWorkspace({ workdir: WORKDIR });
      } catch (e) {
        console.error('[bf-runner] could not release the workspace: ' + (e instanceof Error ? e.message : String(e)));
      }
    }
  }
}

try {
  await serve();
  // A daemon that escaped its process group (setsid) would keep Node alive after the run:
  // the run is over, so end the process and let the job finish.
  process.exit(0);
} catch (e) {
  // A sandbox that could not serve reports nothing terminal: the engine owns the run and
  // will say what it could not do. Fail the job so the Actions UI shows it too.
  console.error('[bf-runner] ' + (e instanceof Error ? e.message : String(e)));
  process.exit(1);
}
`;
}
