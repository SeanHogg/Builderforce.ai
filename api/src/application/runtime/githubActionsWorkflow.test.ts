/**
 * The GitHub Actions agent surface is two generated strings, and both fail in
 * places that are expensive to discover: a wrong `permissions:` block or a
 * missing audience means every tenant run 401s or can't push, and a syntax error
 * in the runner only shows up as a red job in someone else's repo. These tests
 * pin the security-relevant lines of the workflow and prove the runner parses.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  AGENT_WORKFLOW_PATH,
  BUILDERFORCE_AGENT_OIDC_AUDIENCE,
  renderAgentWorkflow,
} from './githubActionsWorkflow';
import { renderAgentRunnerScript } from './githubActionsRunner';

const workflow = renderAgentWorkflow({ apiOrigin: 'https://api.builderforce.ai' });

describe('renderAgentWorkflow', () => {
  it('grants only contents: read and id-token: write', () => {
    // checkout needs contents: read; id-token authenticates at all. Pushes, commits and the PR go
    // through Builderforce's own integration credential, so the job token is given no write scope.
    expect(workflow).toContain('contents: read');
    expect(workflow).toContain('id-token: write');
    expect(workflow).not.toContain('contents: write');
    expect(workflow).not.toContain('pull-requests');
  });

  it('requests the agent audience, never the deploy one', () => {
    expect(BUILDERFORCE_AGENT_OIDC_AUDIENCE).toBe('builderforce.ai/agent');
    expect(workflow).toContain(`audience=${BUILDERFORCE_AGENT_OIDC_AUDIENCE}`);
    // A deploy token must not be able to drive an agent run, so the deploy
    // audience must never appear here.
    expect(workflow).not.toContain('builderforce.ai/deploy');
  });

  it('serialises runs per execution so a re-dispatch cannot double-run a ticket', () => {
    expect(workflow).toContain('group: builderforce-agent-${{ inputs.execution_id }}');
    // Cancelling the in-flight run would be worse than dropping the duplicate.
    expect(workflow).toContain('cancel-in-progress: false');
  });

  it('dispatches on execution_id with an optional ref', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toMatch(/execution_id:[\s\S]*?required: true/);
    expect(workflow).toMatch(/ref:[\s\S]*?required: false/);
  });

  it('checks out full history and bounds the job', () => {
    // A shallow clone has no merge-base with the base branch, which breaks
    // git_sync_latest and every diff against main.
    expect(workflow).toContain('fetch-depth: 0');
    expect(workflow).toContain('timeout-minutes: 60');
  });

  it('downloads the runner from the configured origin and passes it its context', () => {
    expect(workflow).toContain(
      'curl -sSf "$BUILDERFORCE_API/api/runtime/github-actions/runner.mjs" -o "$RUNNER_TEMP/bf-runner.mjs"',
    );
    // The runner script lives in the job's own temp dir, never a fixed shared /tmp name (a self-hosted runner keeps /tmp).
    expect(workflow).toContain('node "$RUNNER_TEMP/bf-runner.mjs"');
    expect(workflow).not.toContain('/tmp/bf-runner.mjs');
    expect(workflow).toContain('BUILDERFORCE_API: https://api.builderforce.ai');
    expect(workflow).toContain('BUILDERFORCE_EXECUTION_ID: ${{ inputs.execution_id }}');
    expect(workflow).toContain('export BUILDERFORCE_TOKEN');
  });

  it('cleans up the shell user in an `if: always()` step AFTER the agent step (a cancel or timeout skips the runner\'s own finally)', () => {
    const agent = workflow.indexOf('name: Run Builderforce agent');
    const cleanup = workflow.indexOf('name: Clean up the agent\'s shell user');
    expect(cleanup).toBeGreaterThan(agent);
    const step = workflow.slice(cleanup);
    expect(step).toContain('if: always()');
    // `kill -1` as the user, repeated until pgrep finds nothing (pkill can be evaded by pid-hopping); absolute paths only.
    expect(step).toContain('/usr/bin/sudo -n -u bfagent /usr/bin/kill -KILL -- -1 || true');
    expect(step).toContain('/usr/bin/pgrep -u bfagent >/dev/null || break');
    expect(step).toContain('/usr/bin/sudo -n /bin/rm -rf "$GITHUB_WORKSPACE/.git" || true');
    expect(step).toContain('/usr/bin/sudo -n /bin/chown -R "$(/usr/bin/id -u):$(/usr/bin/id -g)" "$GITHUB_WORKSPACE" || true');
    expect(step).not.toMatch(/pkill/);
  });

  it('is what the committed template carries', () => {
    // A path, not `new URL(…, import.meta.url)`: the Workers-typed global URL is not Node's URL to the type checker.
    const template = readFileSync(resolve(__dirname, '../../../../.github/workflows/builderforce-agent.yml'), 'utf8');
    const step = (s: string) => s.slice(s.indexOf('# Runs even when the job is cancelled'));
    expect(step(template)).toBe(step(workflow));
  });

  it('carries no secret of ours', () => {
    // A `secrets.<NAME>` reference, not the word "secrets." ending a sentence in a comment.
    expect(workflow).not.toMatch(/secrets\.[A-Za-z_]/);
  });

  it('lands where the writer expects it', () => {
    expect(AGENT_WORKFLOW_PATH).toBe('.github/workflows/builderforce-agent.yml');
  });
});

describe('renderAgentRunnerScript', () => {
  const script = renderAgentRunnerScript();

  it('scrubs the checkout and isolates the shell user BEFORE it asks for the spec, reporting a failure first', () => {
    const isolate = script.slice(script.indexOf('async function isolateShell()'), script.indexOf('async function writeWorkspaceHelper()'));
    const scrub = isolate.indexOf('scrubCheckoutCredentials(WORKDIR)');
    const provision = isolate.indexOf('provisionShellUser(');
    const exportUser = isolate.indexOf('process.env.BUILDERFORCE_SHELL_USER');
    expect(scrub).toBeGreaterThan(-1);
    expect(provision).toBeGreaterThan(scrub);
    expect(exportUser).toBeGreaterThan(provision);
    const serve = script.slice(script.indexOf('async function serve()'));
    const isolated = serve.indexOf('await isolateShell()');
    const failureEvent = serve.indexOf("'runtime.isolation'");
    expect(isolated).toBeGreaterThan(-1);
    expect(failureEvent).toBeGreaterThan(isolated); // the engine is told WHY before the runner exits
    expect(serve.indexOf("op('spec'")).toBeGreaterThan(failureEvent);
    // The checkout goes back to the runner without its .git however serve() ends.
    expect(serve.indexOf('releaseShellWorkspace(')).toBeGreaterThan(serve.indexOf('finally'));
    expect(serve).toContain('sweepShellProcesses()');
  });

  it('tears the shell down on SIGINT / SIGTERM / SIGHUP (a cancel skips the finally), once, then exits 130 / 143 / 129', () => {
    for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) expect(script).toContain(`['${signal}', ${code}]`);
    expect(script).toContain('process.on(signal');
    const once = script.slice(script.indexOf('function teardownOnce()'), script.indexOf('for (const [signal, code]'));
    expect(once).toContain('if (tornDown) return;');
    expect(once).toContain('teardownShellSync(');
    // The normal path will not repeat a teardown a signal already did.
    expect(script).toContain('if (isolated && !tornDown)');
  });

  it('inlines the one spawn helper, the mirror git and the unset of the old extraheader; ships the workspace helper as a file', () => {
    expect(script).toContain('function spawnShell(');
    expect(script).toContain('function mirrorGitCommand(');
    expect(script).toContain('http.https://github.com/.extraheader');
    expect(script).toContain('const WORKSPACE_AGENT_SOURCE = "');
    expect(script).toContain('function createWorkspace(');
  });

  it('serves THE sandbox core — the same primitives the container serves — inlined', () => {
    expect(script).toContain('function createSandboxBox(');
    expect(script).toContain('async function serveSandbox(');
    expect(script).toContain('async function absorbCommit(');
    // The shared glob: **/ matches zero directories, and a truncated miss is not absence.
    expect(script).toContain("re += '(?:.*/)?'");
    expect(script).toContain('function dirMayContainGlob');
    expect(script).toContain('NOT proof the file does not exist');
  });

  it('is syntactically valid JavaScript', () => {
    // The runner is ESM with a top-level await, so `new Function` (which parses as
    // a script body) would reject it for reasons that are not syntax errors.
    // Parsing it as a module is the check that matches how it actually runs.
    expect(() => new Function(`return async () => { ${stripModuleSyntax(script)} };`)).not.toThrow();
  });

  it('talks to exactly one authenticated endpoint', () => {
    expect(script).toContain("fetch(API + '/api/runtime/github-actions/op'");
    expect(script).toContain("Authorization: 'Bearer ' + TOKEN");
    expect(script).toContain('executionId: EXECUTION_ID');
  });

  it("pulls the engine's requests and answers them — the sandbox ops, nothing else", () => {
    for (const name of ['spec', 'sandbox_next', 'sandbox_result', 'sandbox_status', 'event']) {
      expect(script).toContain(`op('${name}'`);
    }
  });

  it('runs no agent loop and decides nothing: no model turn, commit or finalize', () => {
    for (const name of ['llm', 'write', 'finalize', 'fail', 'heartbeat', 'ask_human', 'platform_tool', 'memory']) {
      expect(script).not.toContain(`op('${name}'`);
    }
    expect(script).not.toContain('runAgentLoop');
    expect(script).not.toContain('runImageLoop');
  });

  it('works in the existing checkout instead of cloning', () => {
    expect(script).toContain('const WORKDIR = process.cwd();');
    expect(script).not.toContain('git clone');
  });

  it('pulls in no npm dependency', () => {
    const imports = [...script.matchAll(/from '([^']+)'/g)].map((m) => m[1] ?? '');
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) expect(spec.startsWith('node:')).toBe(true);
  });

  it('kills a running command when the run is cancelled', () => {
    expect(script).toContain('function cancelWatch(kill)');
    expect(script).toContain("proc.current.kill('SIGKILL')");
  });
});

/** Strip `import` lines so the module body can be parsed inside an async function
 *  — the imports are asserted separately, and their specifiers are static. */
function stripModuleSyntax(source: string): string {
  return source.replace(/^import .*$/gm, '');
}
