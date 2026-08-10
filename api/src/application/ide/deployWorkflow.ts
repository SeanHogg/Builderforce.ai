/**
 * The GitHub Actions workflow Builderforce writes into a user's project repo.
 *
 * This is the "pipeline uses GitHub" path: instead of the browser building in a
 * WebContainer and uploading `dist/` itself, the repo builds on a GitHub runner
 * and posts the result back. That buys the things a browser build can't give —
 * a real build log, a build per commit, history, and a deploy that happens even
 * when nobody has the IDE open.
 *
 * The workflow holds NO secret. It requests a short-lived OIDC token scoped to
 * our audience and authenticates with that; see `githubOidc.ts` for why.
 *
 * Generated from one place so the file we seed into a template, the file the
 * "Enable GitHub deploys" action commits, and the file the UI previews can never
 * drift apart.
 */

import { BUILDERFORCE_OIDC_AUDIENCE } from './githubOidc';

/** Where the workflow lives in the user's repo. */
export const DEPLOY_WORKFLOW_PATH = '.github/workflows/builderforce-deploy.yml';

export interface DeployWorkflowOptions {
  /** API origin the runner posts the build to. */
  apiOrigin: string;
  /** Subdomain to publish under. Omitted = the project's existing/derived one. */
  subdomain?: string | null;
  /** Build output directory produced by `npm run build`. */
  distDir?: string;
  /** Branch that triggers a deploy. */
  branch?: string;
  /** Node version for the runner. */
  nodeVersion?: string;
}

/**
 * Render the deploy workflow.
 *
 * Kept as a plain string rather than a YAML library: it is a fixed document with
 * a handful of interpolations, and a dependency-free literal is far easier to
 * read against what actually runs on the runner.
 */
export function renderDeployWorkflow(opts: DeployWorkflowOptions): string {
  const {
    apiOrigin,
    subdomain,
    distDir = 'dist',
    branch = 'main',
    nodeVersion = '20',
  } = opts;

  return `# Managed by Builderforce.ai — builds this project and deploys it to your
# Builderforce subdomain on every push to ${branch}.
#
# No secrets are required. The job requests a short-lived GitHub OIDC token
# (\`id-token: write\`) scoped to the "${BUILDERFORCE_OIDC_AUDIENCE}" audience, and
# Builderforce verifies it against GitHub's public keys to confirm which
# repository is deploying. Nothing here can be replayed against another service.
#
# Edit freely — Builderforce only rewrites this file when you re-run
# "Enable GitHub deploys" from the IDE.
name: Deploy to Builderforce

on:
  push:
    branches: [${branch}]
  workflow_dispatch:

# Never run two deploys of the same branch at once — the second would race the
# first's asset upload and could leave a half-replaced site live.
concurrency:
  group: builderforce-deploy-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      # Required: mints the OIDC token used to authenticate the deploy.
      id-token: write
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '${nodeVersion}'

      # \`npm ci\` needs a lockfile; fall back to \`npm install\` so a project that
      # hasn't committed one still builds instead of failing on step one.
      - name: Install dependencies
        run: |
          if [ -f package-lock.json ]; then npm ci; else npm install; fi

      - name: Build
        run: npm run build

      - name: Deploy to Builderforce
        env:
          BUILDERFORCE_API: ${apiOrigin}
          DIST_DIR: ${distDir}${subdomain ? `\n          SUBDOMAIN: ${subdomain}` : ''}
        run: |
          set -euo pipefail

          if [ ! -d "$DIST_DIR" ]; then
            echo "Build produced no $DIST_DIR/ directory." >&2
            exit 1
          fi

          # Short-lived, audience-scoped proof of which repo this is.
          TOKEN=$(curl -sSf \\
            -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \\
            "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=${BUILDERFORCE_OIDC_AUDIENCE}" \\
            | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).value))")

          # One multipart part per built file, the part NAME being its
          # dist-relative path — the same shape the IDE's browser publish sends.
          ARGS=()${subdomain ? `\n          ARGS+=(-F "subdomain=\${SUBDOMAIN}")` : ''}
          while IFS= read -r -d '' file; do
            rel="\${file#"$DIST_DIR"/}"
            ARGS+=(-F "\${rel}=@\${file}")
          done < <(find "$DIST_DIR" -type f -print0)

          if [ \${#ARGS[@]} -eq 0 ]; then
            echo "No files found under $DIST_DIR/." >&2
            exit 1
          fi

          echo "Deploying \${#ARGS[@]} file(s) to Builderforce…"
          curl -sSf -X POST "$BUILDERFORCE_API/api/deploy/github" \\
            -H "Authorization: Bearer $TOKEN" \\
            "\${ARGS[@]}" \\
            -o response.json

          node -e "const r=require('./response.json');console.log('Deployed '+r.assetCount+' file(s) to '+r.url)"
          echo "### Deployed to $(node -e "console.log(require('./response.json').url)")" >> "$GITHUB_STEP_SUMMARY"
`;
}
