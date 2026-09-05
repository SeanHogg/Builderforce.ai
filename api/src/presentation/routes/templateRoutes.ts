/**
 * Template routes — /api/templates
 *
 * The catalogue, the guided setup and the install, behind one router:
 *   • the gallery   GET  /                      catalogue + how much is connected
 *   • the detail    GET  /:key                  manifest + what it will create
 *   • the wizard    POST /:key/setup            the plan, resolved for right now
 *   • the install   POST /:key/install          validate, bind, materialise
 *   • the author    POST / · POST /:key/publish · DELETE /:key
 *
 * ROLE. Reading the catalogue is OPEN — signed in or not. A template is a
 * description of work, and the list of what you can start from IS the menu of
 * the product: a visitor who is 401'd out of it cannot tell what this is. Signed
 * out the answer is narrower (built-ins plus what publishers listed publicly, and
 * nothing connected) rather than forbidden, which is the same shape the team
 * roster uses — one endpoint answering both visitors, never two catalogues.
 * Installing is DEVELOPER+, matching every other surface that creates a workflow
 * and arms a trigger, and authoring or publishing is MANAGER+, because a
 * published template carries the workspace's name.
 */

import { Hono, type Context } from 'hono';
import { authMiddleware, optionalAuthMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import type { HonoEnv, Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
import {
  listTemplatesForTenant,
  resolveTemplate,
  summarizeTemplates,
} from '../../application/templates/templateRegistry';
import {
  connectedConnectorKeys,
  resolveTemplateSetup,
} from '../../application/templates/templateSetup';
import { installTemplate } from '../../application/templates/installTemplate';
import {
  deleteTemplate,
  saveTemplate,
  setTemplateVisibility,
  TemplateServiceError,
} from '../../application/templates/templateService';
import { TEMPLATE_CATEGORIES } from '../../domain/template/templateManifest';
import type { GuidedAnswers } from '../../domain/guidedSetup/guidedStep';

function fail(c: Context<HonoEnv>, e: unknown) {
  if (e instanceof TemplateServiceError) {
    return c.json({ error: e.message, ...(e.details ? { details: e.details } : {}) }, e.status as 400);
  }
  reportCaughtError(e, { source: 'presentation/routes/templateRoutes.ts', operation: 'handler' });
  return c.json({ error: e instanceof Error ? e.message : 'Template request failed' }, 500);
}

/** Answers arrive as untyped JSON; anything that is not a plausible answer is
 *  dropped rather than passed to a validator that would have to defend itself. */
function coerceAnswers(raw: unknown): GuidedAnswers {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: GuidedAnswers = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === null) { out[k] = null; continue; }
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') { out[k] = v; continue; }
    if (Array.isArray(v)) { out[k] = v.map(String); continue; }
    // The one object-shaped answer is a schedule.
    if (typeof v === 'object' && 'cron' in (v as object)) {
      const s = v as { cron?: unknown; timezone?: unknown };
      out[k] = { cron: String(s.cron ?? ''), timezone: String(s.timezone ?? 'UTC') };
    }
  }
  return out;
}

export function createTemplateRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // GET / — the catalogue this workspace can start from, or the public one.
  //
  // Registered ABOVE the blanket `authMiddleware`, with optional auth of its own:
  // Hono runs handlers in registration order, so this answers and returns before
  // the gate below is ever reached, while every route under it keeps the full
  // gate. `tenantId` is therefore possibly absent — that is the guest.
  router.get('/', optionalAuthMiddleware, async (c) => {
    const tenantId = (c.get('tenantId') as number | undefined) ?? null;
    try {
      const [entries, connected] = await Promise.all([
        listTemplatesForTenant(db, tenantId, c.env as Env),
        // `env` so the connected-key read comes from the cache every connector
        // write already invalidates, rather than scanning the table per request.
        connectedConnectorKeys(db, tenantId, c.env as Env),
      ]);
      return c.json({
        templates: summarizeTemplates(entries, connected),
        categories: TEMPLATE_CATEGORIES,
      });
    } catch (e) {
      return fail(c, e);
    }
  });

  // GET /:key — the full manifest, plus what it will create and what is already
  // connected. This is the page somebody reads BEFORE starting setup.
  router.get('/:key', optionalAuthMiddleware, async (c) => {
    const tenantId = (c.get('tenantId') as number | undefined) ?? null;
    try {
      const template = await resolveTemplate(db, tenantId, c.req.param('key'), c.env as Env);
      if (!template) return c.json({ error: 'Template not found' }, 404);
      const connected = await connectedConnectorKeys(db, tenantId, c.env as Env);
      return c.json({
        template: {
          ...template.manifest,
          origin: template.origin,
          installCount: template.installCount,
          publisherRef: template.publisherRef,
          priceCents: template.priceCents,
          currency: template.currency,
        },
        connectedConnectors: [...connected],
      });
    } catch (e) {
      return fail(c, e);
    }
  });

  // Everything below this line is a workspace operation: authoring, publishing,
  // resolving a setup against live data, installing. Hono applies middleware in
  // registration order, so the two catalogue reads above answered without it and
  // every route from here on carries the full gate — which is also what lets
  // `requireRole` below read a role that is actually there.
  router.use('*', authMiddleware);

  // POST / — save a template of this workspace's own. MANAGER+: a saved template
  // is something other people in the workspace will install.
  router.post('/', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    try {
      const body = await c.req.json<{
        manifest?: unknown;
        publish?: boolean;
        priceCents?: number | null;
        currency?: string | null;
      }>();
      const saved = await saveTemplate(db, c.env as Env, {
        tenantId,
        manifest: body.manifest,
        publisherRef: (c.get('userId') as string | undefined) ?? null,
        publish: body.publish === true,
        priceCents: body.priceCents ?? null,
        currency: body.currency ?? null,
      });
      return c.json(saved, 201);
    } catch (e) {
      return fail(c, e);
    }
  });

  // POST /:key/setup — the guided plan, resolved against the live workspace and
  // the answers so far.
  //
  // A POST rather than a GET because the answers ARE the input: a wizard sends
  // what it has after every step so the next one can be judged against it (a
  // sourced pick-list, a connector that just got connected). Nothing is written.
  router.post('/:key/setup', async (c) => {
    const tenantId = c.get('tenantId') as number;
    try {
      const template = await resolveTemplate(db, tenantId, c.req.param('key'), c.env as Env);
      if (!template) return c.json({ error: 'Template not found' }, 404);
      const body = await c.req
        .json<{ answers?: unknown; touched?: unknown }>()
        .catch(() => ({} as { answers?: unknown; touched?: unknown }));
      const touched = Array.isArray(body.touched)
        ? new Set<string>(body.touched.map(String))
        : undefined;
      const { plan } = await resolveTemplateSetup(
        db,
        c.env as Env,
        tenantId,
        template.manifest,
        coerceAnswers(body.answers),
        { touched },
      );
      return c.json({
        // The step declaration rides with its resolution so the wizard renders
        // from one payload — a client that had to join a manifest fetch against
        // a plan fetch is a client that can render a step the plan never judged.
        steps: plan.steps,
        complete: plan.complete,
        blockedBy: plan.blockedBy,
        missingConnectors: plan.missingConnectors,
      });
    } catch (e) {
      return fail(c, e);
    }
  });

  // POST /:key/install — validate, bind and materialise.
  // DEVELOPER+ — installing creates workflows and arms triggers, which is the
  // same dispatch tier `/workflow-definitions/:id/run` and `/tasks/:id/run-now`
  // carry. A gate the UI applies and the server does not is not a gate.
  router.post('/:key/install', requireRole(TenantRole.DEVELOPER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    try {
      const template = await resolveTemplate(db, tenantId, c.req.param('key'), c.env as Env);
      if (!template) return c.json({ error: 'Template not found' }, 404);
      const body = await c.req.json<{ answers?: unknown }>().catch(() => ({} as { answers?: unknown }));
      const result = await installTemplate({
        db,
        env: c.env as Env,
        tenantId,
        segmentId: c.get('segmentId') ?? null,
        template,
        answers: coerceAnswers(body.answers),
      });
      if (!result.ok) {
        // `blockedBy` rides inside `details` because that is the field the
        // shared client transport preserves on its typed error — putting it
        // top-level would have made it invisible to every caller.
        return c.json({
          error: 'This template is not ready to install yet.',
          code: 'setup_incomplete',
          details: { blockedBy: result.blockedBy, errors: result.errors },
        }, 400);
      }
      return c.json({ outputs: result.outputs, complete: result.complete }, 201);
    } catch (e) {
      return fail(c, e);
    }
  });

  // POST /:key/publish — list (or unlist) a workspace template on the marketplace.
  router.post('/:key/publish', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    try {
      const body = await c.req.json<{ publish?: boolean }>().catch(() => ({ publish: true }));
      return c.json(await setTemplateVisibility(db, c.env as Env, {
        tenantId,
        key: c.req.param('key'),
        publish: body.publish !== false,
      }));
    } catch (e) {
      return fail(c, e);
    }
  });

  router.delete('/:key', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    try {
      await deleteTemplate(db, c.env as Env, { tenantId, key: c.req.param('key') });
      return c.json({ ok: true });
    } catch (e) {
      return fail(c, e);
    }
  });

  return router;
}
