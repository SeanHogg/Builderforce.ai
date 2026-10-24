/**
 * The GitHub Actions agent surface is two generated strings, and both fail in
 * places that are expensive to discover: a wrong `permissions:` block or a
 * missing audience means every tenant run 401s or can't push, and a syntax error
 * in the runner only shows up as a red job in someone else's repo. These tests
 * pin the security-relevant lines of the workflow and prove the runner parses.
 */
import { describe, it, expect } from 'vitest';
import {
  AGENT_WORKFLOW_PATH,
  BUILDERFORCE_AGENT_OIDC_AUDIENCE,
  renderAgentWorkflow,
} from './githubActionsWorkflow';
import { renderAgentRunnerScript } from './githubActionsRunner';

const workflow = renderAgentWorkflow({ apiOrigin: 'https://api.builderforce.ai' });

describe('renderAgentWorkflow', () => {
  it('grants exactly the three permissions the agent needs', () => {
    // contents: write to push the ticket branch, id-token to authenticate at all,
    // pull-requests to open the PR. Anything less breaks a run mid-flight.
    expect(workflow).toContain('contents: write');
    expect(workflow).toContain('id-token: write');
    expect(workflow).toContain('pull-requests: write');
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
      'curl -sSf "$BUILDERFORCE_API/api/runtime/github-actions/runner.mjs" -o /tmp/bf-runner.mjs',
    );
    expect(workflow).toContain('node /tmp/bf-runner.mjs');
    expect(workflow).toContain('BUILDERFORCE_API: https://api.builderforce.ai');
    expect(workflow).toContain('BUILDERFORCE_EXECUTION_ID: ${{ inputs.execution_id }}');
    expect(workflow).toContain('export BUILDERFORCE_TOKEN');
  });

  it('carries no secret of ours', () => {
    expect(workflow).not.toMatch(/secrets\./);
  });

  it('lands where the writer expects it', () => {
    expect(AGENT_WORKFLOW_PATH).toBe('.github/workflows/builderforce-agent.yml');
  });
});

describe('renderAgentRunnerScript', () => {
  const script = renderAgentRunnerScript();

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
