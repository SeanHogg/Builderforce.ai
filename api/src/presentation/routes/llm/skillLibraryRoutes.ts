/**
 * The gateway's Agent Skills transport — the workspace's skill library over REST, for
 * a caller holding a workspace API key or session (the on-prem runtime, a CLI, a
 * script). Every answer comes from `application/skills/skillLibrary`, the same engine
 * the `skills.read` platform tool and the cloud run's catalog use.
 *
 * GET /v1/skills                — the catalog: name, description, source
 * GET /v1/skills/host           — the skills the CALLING agent host must hold on disk,
 *                                 `{ skills: [{ name, updatedAt }] }`; the runtime syncs
 *                                 against it with an exact prune. Agent-host keys only.
 * GET /v1/skills/:name/package  — one skill as an Agent Skills folder (SKILL.md first),
 *                                 what the on-prem runtime writes to disk for an
 *                                 assigned skill
 *
 * Not cached at this layer: the catalog's halves and the host listing's assignment
 * resolution are read-through cached in the application layer, and a package is
 * fetched once per change.
 */
import type { Hono } from 'hono';
import type { Env, HonoEnv } from '../../../env';
import { requestDb } from '../../../application/shared/dbHandle';
import { exportLibrarySkill, skillLibraryCatalog } from '../../../application/skills/skillLibrary';
import { listHostSkills } from '../../../application/skills/hostSkillListing';
import { requireTenantAccess, respondToAccessError, type TenantAccess } from './access';

export function mountSkillLibraryRoutes(router: Hono<HonoEnv>): void {
  router.get('/v1/skills', async (c) => {
    let access: TenantAccess;
    try {
      access = await requireTenantAccess(c);
    } catch (err) {
      return respondToAccessError(c, err);
    }
    const skills = await skillLibraryCatalog(c.env as Env, requestDb(c), access.tenantId);
    return c.json({ skills });
  });

  router.get('/v1/skills/host', async (c) => {
    let access: TenantAccess;
    try {
      access = await requireTenantAccess(c);
    } catch (err) {
      return respondToAccessError(c, err);
    }
    if (access.agentHostId == null) return c.json({ error: 'This listing is for an agent host; authenticate with its agent-host key.' }, 403);
    const skills = await listHostSkills(c.env as Env, requestDb(c), access.tenantId, access.agentHostId);
    return c.json({ skills });
  });

  router.get('/v1/skills/:name/package', async (c) => {
    let access: TenantAccess;
    try {
      access = await requireTenantAccess(c);
    } catch (err) {
      return respondToAccessError(c, err);
    }
    const folder = await exportLibrarySkill(c.env as Env, requestDb(c), access.tenantId, c.req.param('name'));
    if (!folder) return c.json({ error: `No skill named "${c.req.param('name')}" is available to this workspace.` }, 404);
    return c.json(folder);
  });
}
