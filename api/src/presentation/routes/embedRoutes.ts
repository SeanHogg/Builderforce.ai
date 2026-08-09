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

/** Customer-site capabilities migrated from BurnRateOS's unified embed rail. */
const CUSTOMER_FEATURES = [
  'usage_tracking',
  'support_widget',
  'feedback_widget',
  'heatmaps',
  'feature_management',
  'terms_gate',
  'sourcing',
  'lead_forms',
  'push_notifications',
  'onboarding',
  'cookie_consent',
  'hr_widget',
  'status_page',
] as const;
type CustomerFeature = (typeof CUSTOMER_FEATURES)[number];

interface CustomerFeatureConfig {
  enabled: boolean;
  consentVersion: number | null;
  consentedAt: string | null;
  consentedBy: string | null;
}

interface CustomerFeatureConsentEvent {
  feature: CustomerFeature;
  action: 'OPT_IN' | 'OPT_OUT';
  version: number;
  at: string;
  by: string;
}

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

const emptyCustomerFeature = (): CustomerFeatureConfig => ({
  enabled: false,
  consentVersion: null,
  consentedAt: null,
  consentedBy: null,
});

function isCustomerFeature(value: string): value is CustomerFeature {
  return (CUSTOMER_FEATURES as readonly string[]).includes(value);
}

function readCustomerFeatures(raw: string | null | undefined): Record<CustomerFeature, CustomerFeatureConfig> {
  const embed = parseSettings(raw).embed as { customerFeatures?: unknown } | undefined;
  const stored = embed?.customerFeatures && typeof embed.customerFeatures === 'object'
    ? embed.customerFeatures as Record<string, Partial<CustomerFeatureConfig>>
    : {};
  return Object.fromEntries(CUSTOMER_FEATURES.map((key) => {
    const value = stored[key];
    return [key, {
      enabled: value?.enabled === true,
      consentVersion: typeof value?.consentVersion === 'number' ? value.consentVersion : null,
      consentedAt: typeof value?.consentedAt === 'string' ? value.consentedAt : null,
      consentedBy: typeof value?.consentedBy === 'string' ? value.consentedBy : null,
    }];
  })) as Record<CustomerFeature, CustomerFeatureConfig>;
}

function readCustomerConsentLog(raw: string | null | undefined): CustomerFeatureConsentEvent[] {
  const embed = parseSettings(raw).embed as { customerConsentLog?: unknown } | undefined;
  if (!Array.isArray(embed?.customerConsentLog)) return [];
  return embed.customerConsentLog.filter((event): event is CustomerFeatureConsentEvent => {
    if (!event || typeof event !== 'object') return false;
    const row = event as Partial<CustomerFeatureConsentEvent>;
    return typeof row.feature === 'string' && isCustomerFeature(row.feature)
      && (row.action === 'OPT_IN' || row.action === 'OPT_OUT')
      && typeof row.version === 'number' && typeof row.at === 'string' && typeof row.by === 'string';
  });
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
      customerFeatures: readCustomerFeatures(row?.settings),
      customerConsentLog: readCustomerConsentLog(row?.settings),
      customerFeatureKeys: CUSTOMER_FEATURES,
      customerConsentRequiredVersion: EMBED_CONSENT_VERSION,
      publicKey: `bf_${tenantId}`,
      isolationMode: row?.isolationMode ?? 'single',
      // The version the host must (re-)consent to before enabling. The UI compares
      // it against `consentVersion` to decide whether to show the consent modal.
      consentRequiredVersion: EMBED_CONSENT_VERSION,
    });
  });

  router.put('/features/:feature', requireRole(TenantRole.MANAGER), async (c) => {
    const featureParam = c.req.param('feature');
    if (!isCustomerFeature(featureParam)) return c.json({ error: 'Unknown embedded capability' }, 404);

    const tenantId = c.get('tenantId');
    const userId = c.get('userId');
    const body = await c.req.json<{ enabled?: boolean; consentAcknowledged?: boolean }>();
    const enabled = body.enabled === true;

    const [row] = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const settings = parseSettings(row?.settings);
    const embed = settings.embed && typeof settings.embed === 'object'
      ? settings.embed as Record<string, unknown>
      : {};
    const features = readCustomerFeatures(row?.settings);
    const prior = features[featureParam] ?? emptyCustomerFeature();

    if (enabled && prior.consentVersion !== EMBED_CONSENT_VERSION && body.consentAcknowledged !== true) {
      return c.json({
        error: 'Consent required to enable this embedded capability',
        code: 'EMBED_FEATURE_CONSENT_REQUIRED',
        consentRequiredVersion: EMBED_CONSENT_VERSION,
      }, 409);
    }

    const now = new Date().toISOString();
    features[featureParam] = enabled
      ? {
          enabled: true,
          consentVersion: EMBED_CONSENT_VERSION,
          consentedAt: prior.consentVersion === EMBED_CONSENT_VERSION ? prior.consentedAt : now,
          consentedBy: prior.consentVersion === EMBED_CONSENT_VERSION ? prior.consentedBy : userId,
        }
      : { ...prior, enabled: false };
    const consentLog = readCustomerConsentLog(row?.settings);
    if (prior.enabled !== enabled) {
      consentLog.unshift({
        feature: featureParam,
        action: enabled ? 'OPT_IN' : 'OPT_OUT',
        version: EMBED_CONSENT_VERSION,
        at: now,
        by: userId,
      });
    }

    settings.embed = {
      ...embed,
      customerFeatures: features,
      customerConsentLog: consentLog,
    };
    await db
      .update(tenants)
      .set({ settings: JSON.stringify(settings), updatedAt: new Date() })
      .where(eq(tenants.id, tenantId));

    return c.json({ feature: featureParam, ...features[featureParam] });
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
