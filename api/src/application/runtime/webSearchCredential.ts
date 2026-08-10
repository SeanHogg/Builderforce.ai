/**
 * Resolve the web-search BACKING for a surface — which vendor adapter answers a query,
 * and with whose key.
 *
 * This used to be a gate: no BYO key, no `web_search` tool. That made research a paid
 * feature by accident. A logged-out visitor on the public canvas, or a brand-new free
 * workspace, asked "research X and chart it" and the pipeline stopped at its first step
 * — while `geo.geocode`, the step AFTER it, worked keylessly for everyone. So this is
 * now a PRECEDENCE, and it always resolves:
 *
 *   1. the tenant's own key for a keyed vendor — Tavily, then Exa, then Linkup — from
 *      `integration_credentials`, the SAME per-tenant vault every other non-LLM vendor
 *      uses (per-tenant PBKDF2 derivation, `is_enabled` health flag, one CRUD surface at
 *      /api/integrations),
 *   2. the OPERATOR's own SearXNG instance (`SEARXNG_URL`, unset by default). Open-web
 *      coverage with no vendor account, no per-query meter, and no third party learning
 *      what a tenant researches — the right shape for a self-hosted product, which is
 *      why it sits above the keyless floor and below a tenant's deliberate choice,
 *   3. the KEYLESS vendor — no account, no meter, no infrastructure, attribution-only
 *      licence. Narrower coverage, stated as such in the result, but real citable
 *      sources.
 *
 * (The LLM BYO table, `tenant_llm_provider_keys`, is deliberately NOT reused: its
 * `provider` union means "vendor that serves models", and widening it would leak a
 * search vendor into model routing, BYO priority, and model-choice gating.)
 *
 * Nothing here is cached: a decrypted vendor secret must not land in the KV cache, and
 * this is one indexed lookup per RUN (not per step), not per request. The SEARCH itself
 * is cached — see `cloudWeb.searchWeb`.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { integrationCredentials } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { decryptCredentials } from '../integrations/credentialCrypto';
import {
  CREDENTIALED_WEB_SEARCH_VENDOR_IDS, searxngSearchVendor, webSearchVendor, wikipediaSearchVendor,
  type WebSearchAuth, type WebSearchVendor,
} from './webSearchVendors';

export interface ResolvedWebSearchBacking {
  vendor: WebSearchVendor;
  /** How the chosen vendor is addressed/authenticated. Both fields are absent-or-null
   *  for the keyless floor — see {@link WebSearchAuth}. */
  auth: WebSearchAuth;
  /** Where the backing came from — surfaced in the run log so an operator can tell a
   *  tenant's own key from the operator's own instance from the keyless fallback. */
  source: 'tenant' | 'operator' | 'keyless';
}

/** Field names a credential blob may carry the key under. `apiKey` is what the
 *  integrations UI writes for a search vendor; the others are accepted because the
 *  shared vault's existing rows use them and a tenant pasting into the generic form
 *  should not silently produce a dead integration. */
const KEY_FIELDS = ['apiKey', 'apiToken', 'token', 'accessToken'] as const;

/** First non-empty string among the known key fields of a decrypted blob. */
function pickApiKey(creds: Record<string, unknown>): string | null {
  for (const f of KEY_FIELDS) {
    const v = creds[f];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/**
 * The backing available to a surface with NO tenant in scope — the operator's own
 * SearXNG instance if the deployment runs one, else the keyless vendor. This is what the
 * logged-out guest canvas searches with, and it is also the floor beneath every tenant
 * lookup, so the "what does search fall back to" answer exists in exactly one place.
 */
export function platformWebSearchBacking(env: Env | undefined): ResolvedWebSearchBacking {
  const searxngUrl = env?.SEARXNG_URL?.trim();
  if (searxngUrl) return { vendor: searxngSearchVendor, auth: { apiKey: null, baseUrl: searxngUrl }, source: 'operator' };
  return { vendor: wikipediaSearchVendor, auth: { apiKey: null }, source: 'keyless' };
}

/**
 * The backing for one tenant. NEVER null: a tenant with no key still researches, just
 * against a narrower index.
 *
 * The tenant lookup is strict on purpose — a row that is disabled, undecryptable, empty,
 * or for a vendor this build has no adapter for is treated as absent and falls through
 * to the platform floor, rather than producing a vendor that is certain to fail. Never
 * throws: a DB hiccup degrades to the keyless floor, never to a failed run.
 */
export async function resolveWebSearchBacking(
  env: Env | undefined,
  db: Db,
  tenantId: number,
): Promise<ResolvedWebSearchBacking> {
  try {
    const secret = env?.INTEGRATION_ENCRYPTION_SECRET ?? env?.JWT_SECRET;
    if (secret) {
      const rows = await db
        .select({
          provider: integrationCredentials.provider,
          credentialsEnc: integrationCredentials.credentialsEnc,
          iv: integrationCredentials.iv,
        })
        .from(integrationCredentials)
        .where(and(
          eq(integrationCredentials.tenantId, tenantId),
          eq(integrationCredentials.isEnabled, true),
          // `inArray` over the port's id list, so a second adapter needs no query edit.
          inArray(integrationCredentials.provider, [...CREDENTIALED_WEB_SEARCH_VENDOR_IDS]),
        ));

      // Walk the port's id list in ITS order, not the rows' — a tenant with two keys
      // connected gets the documented precedence rather than whichever row the planner
      // happened to return first.
      for (const id of CREDENTIALED_WEB_SEARCH_VENDOR_IDS) {
        const row = rows.find((candidate) => candidate.provider === id);
        const vendor = row ? webSearchVendor(row.provider) : null;
        if (!row || !vendor || vendor.keyless) continue;
        const creds = await decryptCredentials(row.credentialsEnc, row.iv, secret, tenantId);
        if (!creds) continue;
        const apiKey = pickApiKey(creds);
        if (apiKey) return { vendor, auth: { apiKey }, source: 'tenant' };
      }
    }
  } catch (error) {
    // Fall through to the platform floor — a tenant lookup failure must not remove
    // the capability, only the widening its key would have bought. Reported because a
    // tenant that PAID for a key and silently got the keyless index is a real defect,
    // and this is the only place it would ever be visible.
    reportCaughtError(error, {
      source: 'application/runtime/webSearchCredential.ts',
      operation: 'resolveWebSearchBacking',
      context: { tenantId },
    });
  }
  return platformWebSearchBacking(env);
}
