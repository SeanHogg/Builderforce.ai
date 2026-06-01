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

// Mirror of @seanhogg/builderforce-embedded EMBED_CONSENT_VERSION (same
// duplication posture as CAPABILITIES). Enabling the embed records that the
// acting admin consented to THIS version; bump both in lockstep.
const EMBED_CONSENT_VERSION = 1;

interface EmbedConfig {
  enabled: boolean;
  capabilities: Capability[];
  /** Consent text version the tenant last agreed to (null = never consented). */
  consentVersion: number | null;
  /** ISO timestamp of that consent. */
  consentedAt: string | null;
  /** userId of the admin who consented. */
  consentedBy: string | null;
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
  const embed = parseSettings(raw).embed as
    | { enabled?: unknown; capabilities?: unknown; consentVersion?: unknown; consentedAt?: unknown; consentedBy?: unknown }
    | undefined;
  return {
    enabled: embed?.enabled === true,
    capabilities: Array.isArray(embed?.capabilities) ? embed!.capabilities.filter(isCapability) : [],
    consentVersion: typeof embed?.consentVersion === 'number' ? embed.consentVersion : null,
    consentedAt: typeof embed?.consentedAt === 'string' ? embed.consentedAt : null,
    consentedBy: typeof embed?.consentedBy === 'string' ? embed.consentedBy : null,
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
    const embed = readEmbed(row?.settings);
    return c.json({
      ...embed,
      isolationMode: row?.isolationMode ?? 'single',
      // The version the host must (re-)consent to before enabling. The UI compares
      // it against `consentVersion` to decide whether to show the consent modal.
      consentRequiredVersion: EMBED_CONSENT_VERSION,
    });
  });

  router.put('/config', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId');
    const userId = c.get('userId');
    const body = await c.req.json<{ enabled?: boolean; capabilities?: unknown; consentAcknowledged?: boolean }>();
    const capabilities = Array.isArray(body.capabilities) ? body.capabilities.filter(isCapability) : [];
    const enabled = body.enabled === true;

    const [row] = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const settings = parseSettings(row?.settings);
    const prior = readEmbed(row?.settings);

    // Consent gate: turning the embed ON requires a recorded consent at the
    // current version. If the tenant has never consented (or consented to an
    // older version), the admin must acknowledge the consent modal in this call.
    let consentVersion = prior.consentVersion;
    let consentedAt = prior.consentedAt;
    let consentedBy = prior.consentedBy;
    if (enabled) {
      const hasCurrentConsent = prior.consentVersion === EMBED_CONSENT_VERSION;
      if (!hasCurrentConsent) {
        if (body.consentAcknowledged !== true) {
          return c.json(
            { error: 'Consent required to enable the embedded integration', code: 'EMBED_CONSENT_REQUIRED', consentRequiredVersion: EMBED_CONSENT_VERSION },
            409,
          );
        }
        consentVersion = EMBED_CONSENT_VERSION;
        consentedAt = new Date().toISOString();
        consentedBy = userId;
      }
    }

    settings.embed = { enabled, capabilities, consentVersion, consentedAt, consentedBy };

    await db
      .update(tenants)
      .set({ settings: JSON.stringify(settings), updatedAt: new Date() })
      .where(eq(tenants.id, tenantId));

    return c.json({ enabled, capabilities, consentVersion, consentedAt, consentedBy });
  });

  return router;
}
