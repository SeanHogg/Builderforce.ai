/**
 * GitHub Actions deploy ingress — POST /api/deploy/github
 *
 * The public half of the "pipeline uses GitHub" path. A workflow in the user's
 * own repo (see `deployWorkflow.ts`) builds the project on a GitHub runner and
 * posts `dist/` here.
 *
 * Deliberately NOT behind `authMiddleware`: there is no tenant JWT on a CI
 * runner. Authentication is the GitHub Actions OIDC token in the Authorization
 * header, which proves WHICH REPOSITORY is calling. Authorization is then the
 * existing repo↔project binding: a repo may only deploy to the project it is
 * linked to, and the tenant is read from that row rather than from the request.
 * So a valid token for repo A can never publish to a project linked to repo B.
 */

import { Hono } from 'hono';
import { neon } from '@neondatabase/serverless';
import type { HonoEnv } from '../../env';
import { verifyGitHubOidcToken } from '../../application/ide/githubOidc';
import { publishStaticSite, assetsFromFormData } from '../../application/ide/publishStaticSite';

export function createDeployRoutes(): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  router.post('/github', async (c) => {
    const bucket = c.env.UPLOADS;
    if (!bucket) return c.json({ error: 'Storage not configured' }, 503);

    const auth = c.req.header('Authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token) {
      return c.json({ error: 'Missing GitHub OIDC token. The workflow needs `id-token: write`.' }, 401);
    }

    const verified = await verifyGitHubOidcToken(c.env, token);
    if (!verified.ok) return c.json({ error: verified.error }, 401);

    const [owner, repo] = verified.claims.repository.split('/');
    const sql = neon(c.env.NEON_DATABASE_URL);

    // The repo↔project binding IS the authorization. Prefer the default binding
    // when a repo somehow backs more than one project.
    const [binding] = await sql`
      SELECT pr.project_id, pr.tenant_id, p.name
      FROM project_repositories pr
      JOIN projects p ON p.id = pr.project_id
      WHERE pr.provider = 'github'
        AND lower(pr.owner) = lower(${owner})
        AND lower(pr.repo)  = lower(${repo})
      ORDER BY pr.is_default DESC, pr.created_at ASC
      LIMIT 1`;

    if (!binding) {
      return c.json({
        error: `Repository "${verified.claims.repository}" is not linked to a Builderforce project. `
          + 'Connect it from the IDE (Settings → Repository) first.',
      }, 404);
    }

    const form = await c.req.formData();
    const result = await publishStaticSite({
      env: c.env,
      sql,
      bucket,
      projectId: Number(binding.project_id),
      tenantId: Number(binding.tenant_id),
      projectName: String(binding.name ?? ''),
      requestedSubdomain: form.get('subdomain') as string | null,
      assets: assetsFromFormData(form, ['subdomain']),
    });
    if (!result.ok) return c.json({ error: result.error }, result.status);

    const { ok: _ok, ...body } = result;
    return c.json({ ...body, repository: verified.claims.repository, sha: verified.claims.sha }, 201);
  });

  return router;
}
