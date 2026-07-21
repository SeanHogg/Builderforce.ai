/**
 * Resolve the tenant's BYO web-search credential — the gate that decides whether a
 * cloud run gets the `web_search` tool at all.
 *
 * Web search is metered per query by the vendor, so there is no platform-funded key:
 * the tenant brings their own. That key lives in `integration_credentials`, the SAME
 * per-tenant vault every other non-LLM vendor (github/jira/sentry/linear/…) uses —
 * per-tenant PBKDF2 key derivation, `is_enabled` health flag, one CRUD surface at
 * /api/integrations — rather than a parallel store invented for search. (The LLM BYO
 * table, `tenant_llm_provider_keys`, is deliberately NOT reused: its `provider` union
 * means "vendor that serves models", and widening it would leak a search vendor into
 * model routing, byo priority, and model-choice gating.)
 *
 * Precedence mirrors the LLM BYO convention (tenant key wins, operator env is a floor):
 * a tenant row first, then an OPTIONAL operator-wide `BRAVE_SEARCH_API_KEY`. That env
 * var is unset by default and the platform ships no key — with neither configured this
 * returns null and the capability simply is not advertised.
 *
 * Nothing here is cached: a decrypted vendor secret must not land in the KV cache, and
 * this is one indexed lookup per RUN (not per step), not per request.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { integrationCredentials } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { decryptCredentials } from '../integrations/credentialCrypto';
import { WEB_SEARCH_VENDOR_IDS, webSearchVendor, type WebSearchVendor } from './webSearchVendors';

export interface ResolvedWebSearchCredential {
  vendor: WebSearchVendor;
  apiKey: string;
  /** Where the key came from — surfaced in the run log so an operator can tell a
   *  tenant's own key from the (rare) operator-wide floor. */
  source: 'tenant' | 'operator';
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
 * The tenant's usable search credential, or null when search must stay off.
 *
 * "Usable" is strict on purpose — a row that is disabled, undecryptable, empty, or for
 * a vendor this build has no adapter for all resolve to null, because the whole point
 * of self-gating is that an ADVERTISED `web_search` is one that can actually run. Never
 * throws: a DB hiccup degrades to "no search", never to a failed run.
 */
export async function resolveWebSearchCredential(
  env: Env,
  db: Db,
  tenantId: number,
): Promise<ResolvedWebSearchCredential | null> {
  try {
    const secret = env.INTEGRATION_ENCRYPTION_SECRET ?? env.JWT_SECRET;
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
          inArray(integrationCredentials.provider, [...WEB_SEARCH_VENDOR_IDS]),
        ));

      for (const row of rows) {
        const vendor = webSearchVendor(row.provider);
        if (!vendor) continue;
        const creds = await decryptCredentials(row.credentialsEnc, row.iv, secret, tenantId);
        if (!creds) continue;
        const apiKey = pickApiKey(creds);
        if (apiKey) return { vendor, apiKey, source: 'tenant' };
      }
    }

    // Operator-wide floor. Unset in every default deployment — this exists so a
    // self-hoster CAN fund search for all their tenants, not because the platform does.
    const operatorKey = env.BRAVE_SEARCH_API_KEY?.trim();
    const brave = webSearchVendor('brave_search');
    if (operatorKey && brave) return { vendor: brave, apiKey: operatorKey, source: 'operator' };

    return null;
  } catch {
    return null;
  }
}
