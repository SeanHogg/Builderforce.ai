/**
 * Embed integration config — /api/embed/config
 *
 * The SuperAdmin of a host tenant (e.g. BurnRateOS) enables the embedded
 * integration and chooses which capability areas (Product / Security / Agile)
 * are exposed as embeddable widgets. Stored on `tenants.settings.embed`.
 *
 * GET  /api/embed/config  – read the current tenant's embed enablement (any member)
 * PUT  /api/embed/config  – enable/disable + set capabilities (manager+)
 *
 * The embed frame (`/embed/[view]`) reads this to SELF-GATE: a view whose
 * capability isn't enabled renders a "not enabled" state — no prop-drilled flags.
 */

import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { TenantRole } from '../../domain/shared/types';
import { tenants } from '../../infrastructure/database/schema';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

// Mirror of the package's EmbedCapability set (single source of truth lives in
// @seanhogg/builderforce-embedded views.ts; duplicated here only to validate the
// PUT payload server-side — same posture as the postMessage protocol).
const CAPABILITIES = ['product', 'security', 'agile'] as const;
type Capability = (typeof CAPABILITIES)[number];
const isCapability = (v: unknown): v is Capability =>
  typeof v === 'string' && (CAPABILITIES as readonly string[]).includes(v);

interface EmbedConfig {
  enabled: boolean;
  capabilities: Capability[];
}

function parseSettings(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function readEmbed(raw: string | null | undefined): EmbedConfig {
  const embed = parseSettings(raw).embed as { enabled?: unknown; capabilities?: unknown } | undefined;
  return {
    enabled: embed?.enabled === true,
    capabilities: Array.isArray(embed?.capabilities) ? embed!.capabilities.filter(isCapability) : [],
  };
}

export function createEmbedRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  router.get('/config', async (c) => {
    const tenantId = c.get('tenantId');
    const [row] = await db
      .select({ settings: tenants.settings, isolationMode: tenants.isolationMode })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    return c.json({ ...readEmbed(row?.settings), isolationMode: row?.isolationMode ?? 'single' });
  });

  router.put('/config', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId');
    const body = await c.req.json<{ enabled?: boolean; capabilities?: unknown }>();
    const capabilities = Array.isArray(body.capabilities) ? body.capabilities.filter(isCapability) : [];
    const enabled = body.enabled === true;

    const [row] = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const settings = parseSettings(row?.settings);
    settings.embed = { enabled, capabilities };

    await db
      .update(tenants)
      .set({ settings: JSON.stringify(settings), updatedAt: new Date() })
      .where(eq(tenants.id, tenantId));

    return c.json({ enabled, capabilities });
  });

  return router;
}
