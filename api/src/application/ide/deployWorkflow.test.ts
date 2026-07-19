import { describe, it, expect } from 'vitest';
import { renderDeployWorkflow, DEPLOY_WORKFLOW_PATH } from './deployWorkflow';
import { BUILDERFORCE_OIDC_AUDIENCE } from './githubOidc';

/**
 * This file is committed into a USER's repository and then executed by GitHub on
 * their runner. A mistake here doesn't fail our build — it fails theirs, after a
 * push, in a log they have to go read. So the shape is locked down: the OIDC
 * permission and audience the deploy depends on, and the absence of anything
 * secret-shaped.
 */

const base = { apiOrigin: 'https://api.builderforce.ai' };

describe('renderDeployWorkflow', () => {
  it('requests the id-token permission the OIDC deploy depends on', () => {
    const yaml = renderDeployWorkflow(base);
    expect(yaml).toContain('id-token: write');
    // Least privilege: the job only reads the repo.
    expect(yaml).toContain('contents: read');
  });

  it('requests a token for OUR audience, matching what the verifier requires', () => {
    // A drift between these two is the failure that would only show up as a live
    // 401 on someone else's runner.
    expect(renderDeployWorkflow(base)).toContain(`audience=${BUILDERFORCE_OIDC_AUDIENCE}`);
  });

  it('posts to the deploy endpoint at the given API origin', () => {
    // The origin rides an env var, so a preview/staging API writes a workflow
    // that reports back to itself rather than to production.
    const yaml = renderDeployWorkflow({ apiOrigin: 'https://staging-api.example' });
    expect(yaml).toContain('BUILDERFORCE_API: https://staging-api.example');
    expect(yaml).toContain('"$BUILDERFORCE_API/api/deploy/github"');
    expect(yaml).not.toContain('api.builderforce.ai');
  });

  it('embeds no secret, token or key material', () => {
    const yaml = renderDeployWorkflow(base);
    // `secrets.` is the giveaway that we started depending on repo secrets; the
    // whole point of the OIDC design is that this file needs none.
    expect(yaml).not.toMatch(/\$\{\{\s*secrets\./);
    expect(yaml).not.toMatch(/api[_-]?key/i);
  });

  it('triggers on the requested branch and guards against concurrent deploys', () => {
    const yaml = renderDeployWorkflow({ ...base, branch: 'develop' });
    expect(yaml).toContain('branches: [develop]');
    // Two overlapping deploys would race the asset upload and could leave a
    // half-replaced site live.
    expect(yaml).toContain('concurrency:');
    expect(yaml).toContain('cancel-in-progress: true');
  });

  it('includes the subdomain only when one is pinned', () => {
    expect(renderDeployWorkflow({ ...base, subdomain: 'my-app' })).toContain('SUBDOMAIN: my-app');
    const without = renderDeployWorkflow(base);
    expect(without).not.toContain('SUBDOMAIN:');
    expect(without).not.toContain('subdomain=');
  });

  it('honours a custom dist directory and node version', () => {
    const yaml = renderDeployWorkflow({ ...base, distDir: 'build', nodeVersion: '22' });
    expect(yaml).toContain('DIST_DIR: build');
    expect(yaml).toContain("node-version: '22'");
  });

  it('falls back to npm install when the project has no lockfile', () => {
    // `npm ci` hard-fails without a lockfile; a scaffolded project may not have
    // committed one yet, and failing on step one would be a bad first run.
    const yaml = renderDeployWorkflow(base);
    expect(yaml).toContain('if [ -f package-lock.json ]; then npm ci; else npm install; fi');
  });

  it('fails loudly when the build produced no output', () => {
    const yaml = renderDeployWorkflow(base);
    expect(yaml).toContain('set -euo pipefail');
    expect(yaml).toMatch(/Build produced no .* directory/);
  });

  it('lands at the conventional workflow path', () => {
    expect(DEPLOY_WORKFLOW_PATH).toBe('.github/workflows/builderforce-deploy.yml');
  });
});
