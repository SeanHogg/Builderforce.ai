/**
 * The GitHub Actions workflow Builderforce writes into a user's project repo to
 * run an agent — the "GitHub Actions" execution surface.
 *
 * This is a third surface alongside the durable one (one LLM step per DO alarm
 * tick, no shell) and the container one (a long-lived Node process with a real
 * shell). What GitHub Actions buys that neither of those does is the customer's
 * OWN compute and the customer's OWN network: the agent builds and tests inside
 * the repo's real CI environment, with whatever toolchain, caches, and private
 * registry access that repo already has, and it costs us nothing to run.
 *
 * The workflow holds NO secret. It requests a short-lived OIDC token scoped to
 * our agent audience and authenticates every call back to us with that; see
 * `githubOidc.ts` for why that beats writing a long-lived token into a repo we
 * don't control.
 *
 * Generated from one place so the file we seed into a template, the file the
 * "Enable GitHub agent runs" action commits, and the file the UI previews can
 * never drift apart.
 */

/** Where the workflow lives in the user's repo. */
export const AGENT_WORKFLOW_PATH = '.github/workflows/builderforce-agent.yml';

/**
 * The audience an agent workflow must request — DELIBERATELY DISTINCT from the
 * deploy audience (`builderforce.ai/deploy`).
 *
 * The two capabilities are not equivalent and must not share a credential. A
 * deploy token publishes static assets we already have. An agent token drives an
 * LLM loop: it spends the tenant's model budget, writes code into the repo, and
 * opens pull requests. If both accepted the same audience, a token minted by any
 * deploy workflow — including one in a repo whose write access is much broader
 * than its agent authorization — could be replayed to start agent runs. Separate
 * audiences make that replay a 401 instead of a bill.
 */
export const BUILDERFORCE_AGENT_OIDC_AUDIENCE = 'builderforce.ai/agent';

export interface AgentWorkflowOptions {
  /** API origin the runner pulls its script from and posts every op to. */
  apiOrigin: string;
  /** Node version for the runner. Needs global fetch, so 20+. */
  nodeVersion?: string;
}

/**
 * Render the agent workflow.
 *
 * Kept as a plain string rather than a YAML library, matching `deployWorkflow.ts`:
 * it is a fixed document with a couple of interpolations, and a dependency-free
 * literal is far easier to read against what actually runs on the runner.
 */
export function renderAgentWorkflow(opts: AgentWorkflowOptions): string {
  const { apiOrigin, nodeVersion = '22' } = opts;

  return `# Managed by Builderforce.ai — runs a Builderforce agent on this repo,
# on your own GitHub Actions runner.
#
# Started by Builderforce via workflow_dispatch when a task is assigned to a
# GitHub Actions agent. You can also run it by hand from the Actions tab if you
# have an execution id.
#
# No secrets are required. The job requests a short-lived GitHub OIDC token
# (\`id-token: write\`) scoped to the "${BUILDERFORCE_AGENT_OIDC_AUDIENCE}" audience,
# and Builderforce verifies it against GitHub's public keys to confirm which
# repository is asking. Nothing here can be replayed against another service —
# and a token minted by the deploy workflow cannot drive an agent run.
#
# Edit freely — Builderforce only rewrites this file when you re-run
# "Enable GitHub agent runs" from the app.
name: Builderforce Agent

on:
  workflow_dispatch:
    inputs:
      execution_id:
        description: 'Builderforce execution id to run'
        required: true
        type: string
      ref:
        description: 'Branch or SHA to check out (defaults to the repo default branch)'
        required: false
        type: string

# One run per execution, ever. A re-dispatch of the same execution (a retried
# webhook, an impatient click) would otherwise put two agents on the same ticket
# branch, each committing over the other's work. Not cancel-in-progress: the
# first run is the real one and killing it mid-commit is worse than dropping the
# duplicate.
concurrency:
  group: builderforce-agent-\${{ inputs.execution_id }}
  cancel-in-progress: false

jobs:
  agent:
    runs-on: ubuntu-latest
    # An agent loop is long: it builds, tests, and iterates. 60 minutes is well
    # past a healthy run and still bounds a wedged one.
    timeout-minutes: 60
    permissions:
      # The agent commits its work and pushes the ticket branch.
      contents: write
      # Required: mints the OIDC token used to authenticate back to Builderforce.
      id-token: write
      # The agent opens a pull request when it finishes.
      pull-requests: write
    steps:
      # fetch-depth: 0 — a shallow clone has no merge-base with the base branch,
      # so \`git merge-base\`, \`git diff main\`, and syncing the latest base all
      # break. The container surface learned this the hard way; full history here.
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          ref: \${{ inputs.ref }}

      - uses: actions/setup-node@v4
        with:
          node-version: '${nodeVersion}'

      - name: Run Builderforce agent
        env:
          BUILDERFORCE_API: ${apiOrigin}
          BUILDERFORCE_EXECUTION_ID: \${{ inputs.execution_id }}
        run: |
          set -euo pipefail

          # Short-lived, audience-scoped proof of which repo this is.
          BUILDERFORCE_TOKEN=$(curl -sSf \\
            -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \\
            "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=${BUILDERFORCE_AGENT_OIDC_AUDIENCE}" \\
            | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).value))")
          export BUILDERFORCE_TOKEN

          # The agent loop is DOWNLOADED, not inlined in this YAML, on purpose.
          # This file is committed into every tenant repo, so anything written
          # here is frozen at commit time and can only be changed by re-committing
          # to each repo one by one. Keeping the committed surface to "mint a
          # token, fetch the runner, run it" means the loop — new tools, a fixed
          # cancel path, a protocol change — ships centrally and every repo picks
          # it up on its next run. It also keeps the file small enough to actually
          # read and audit, which is the whole point of it being visible.
          curl -sSf "$BUILDERFORCE_API/api/runtime/github-actions/runner.mjs" -o /tmp/bf-runner.mjs
          node /tmp/bf-runner.mjs
`;
}
