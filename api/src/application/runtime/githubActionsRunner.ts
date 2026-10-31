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
 *     Bearer` on every op, verified against GitHub's JWKS (`githubOidc.ts`).
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

import { SANDBOX_CORE_IMPORTS, SANDBOX_CORE_INLINE } from './generated/sandboxCoreSource';

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
const TOKEN = process.env.BUILDERFORCE_TOKEN || '';
const EXECUTION_ID = Number(process.env.BUILDERFORCE_EXECUTION_ID || 0);

/** The checkout actions/checkout produced. We never clone; this already exists. */
const WORKDIR = process.cwd();
/** How often a running command asks whether the run was cancelled. */
const CANCEL_POLL_MS = 15 * 1000;

if (!API || !TOKEN || !EXECUTION_ID) {
  console.error('[bf-runner] missing BUILDERFORCE_API / BUILDERFORCE_TOKEN / BUILDERFORCE_EXECUTION_ID');
  process.exit(1);
}

/** POST an op back to the Worker; returns the parsed JSON body. */
async function op(name, args) {
  const res = await fetch(API + '/api/runtime/github-actions/op', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify({ executionId: EXECUTION_ID, op: name, args: args || {} }),
  });
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

async function serve() {
  const spec = await op('spec', {});
  if (!spec || spec.error) throw new Error('could not load the sandbox spec: ' + ((spec && spec.error) || 'unknown'));
  const box = createSandboxBox({
    spec,
    workdir: WORKDIR,
    branch: (spec.repo && spec.repo.headBranch) || null,
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

  // Serve until the run releases us (finished, cancelled, or parked on a question). However
  // that ends, the run's background jobs end with it.
  try {
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
    await closeSandboxBox(box);
  }
}

try {
  await serve();
} catch (e) {
  // A sandbox that could not serve reports nothing terminal: the engine owns the run and
  // will say what it could not do. Fail the job so the Actions UI shows it too.
  console.error('[bf-runner] ' + (e instanceof Error ? e.message : String(e)));
  process.exit(1);
}
`;
}
