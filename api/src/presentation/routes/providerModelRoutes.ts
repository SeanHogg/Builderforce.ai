/**
 * Provider MODEL SELECTION routes — list what a connected provider account can run, and
 * save the tenant's ordered choice (1165).
 *
 *   GET /provider-keys/:provider/models
 *     → { supported, connected, accountChecked, models: [{ id, onAccount, inCatalog }], selected, maxSelected }
 *   PUT /provider-keys/:provider/models  { models: string[] }  → { ok, selected }
 *
 * A module of its own (like the subscription OAuth routes) rather than two more handlers in
 * the gateway route file. Every read here is served from a read-through cache — the public
 * catalog (shared), the key's own model list and the selection (per tenant) — each
 * invalidated by its writer, so opening the drawer costs no upstream call in steady state.
 */

import type { Context, Hono } from 'hono';
import type { HonoEnv } from '../../env';
import { parseOptionalBody, z } from './requestBody';
import { isSupportedProvider, listTenantProviderKeys } from '../../application/llm/tenantProviderKeyService';
import { listProviderModelChoices, providerSupportsModelChoice } from '../../application/llm/providerModelCatalog';
import {
  MAX_SELECTED_PROVIDER_MODELS,
  listProviderModelSelections,
  normalizeModelSelection,
  replaceProviderModelSelection,
} from '../../application/llm/providerModelSelection';

export interface ProviderModelRoutesGate {
  requireTenantAccess(c: Context<HonoEnv>): Promise<{ tenantId: number }>;
  respondToAccessError(c: Context<HonoEnv>, err: unknown): Response;
}

/** `models` is validated by `normalizeModelSelection`, which owns the id rules. */
const ProviderModelsBody = z.object({ models: z.unknown().optional() });

export function mountProviderModelRoutes(router: Hono<HonoEnv>, gate: ProviderModelRoutesGate): void {
  router.get('/provider-keys/:provider/models', async (c) => {
    let access: { tenantId: number };
    try { access = await gate.requireTenantAccess(c); } catch (err) { return gate.respondToAccessError(c, err); }
    const provider = c.req.param('provider');
    if (!isSupportedProvider(provider)) return c.json({ error: 'unsupported provider' }, 400);
    if (!providerSupportsModelChoice(provider)) {
      return c.json({ supported: false, connected: false, accountChecked: false, models: [], selected: [], maxSelected: MAX_SELECTED_PROVIDER_MODELS });
    }
    const [connected, selections, choices] = await Promise.all([
      listTenantProviderKeys(c.env, access.tenantId),
      listProviderModelSelections(c.env, access.tenantId),
      listProviderModelChoices(c.env, access.tenantId, provider),
    ]);
    return c.json({
      supported: true,
      connected: connected.some((row) => row.provider === provider),
      accountChecked: choices?.accountChecked ?? false,
      models: choices?.models ?? [],
      selected: selections[provider] ?? [],
      maxSelected: MAX_SELECTED_PROVIDER_MODELS,
    });
  });

  router.put('/provider-keys/:provider/models', async (c) => {
    let access: { tenantId: number };
    try { access = await gate.requireTenantAccess(c); } catch (err) { return gate.respondToAccessError(c, err); }
    const provider = c.req.param('provider');
    if (!isSupportedProvider(provider) || !providerSupportsModelChoice(provider)) {
      return c.json({ error: 'unsupported_provider' }, 400);
    }
    const body = await parseOptionalBody(c, ProviderModelsBody);
    const normalized = normalizeModelSelection(body.models ?? []);
    if (!normalized.ok) return c.json({ error: normalized.error, maxSelected: MAX_SELECTED_PROVIDER_MODELS }, 400);

    const [connected, selections, choices] = await Promise.all([
      listTenantProviderKeys(c.env, access.tenantId),
      listProviderModelSelections(c.env, access.tenantId),
      listProviderModelChoices(c.env, access.tenantId, provider),
    ]);
    // A selection belongs to a CONNECTED account (the table's foreign key says so too);
    // answering here names the problem instead of surfacing a constraint violation.
    if (!connected.some((row) => row.provider === provider)) return c.json({ error: 'not_connected' }, 409);
    // Only ids the provider lists — plus any already selected, so a model the catalog later
    // drops can still be reordered or removed rather than blocking every save.
    const known = new Set([...(choices?.models.map((m) => m.id) ?? []), ...(selections[provider] ?? [])]);
    const unknown = known.size > 0 ? normalized.models.filter((id) => !known.has(id)) : [];
    if (unknown.length > 0) return c.json({ error: 'unknown_models', models: unknown }, 400);

    await replaceProviderModelSelection(c.env, access.tenantId, provider, normalized.models);
    return c.json({ ok: true, selected: normalized.models });
  });
}
