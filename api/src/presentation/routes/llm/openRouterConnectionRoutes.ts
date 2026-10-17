/**
 * OpenRouter registrations — each named connection owns one ordered set of selected
 * models and may optionally bind the tenant's OpenRouter key.
 *
 * GET    /openrouter-connections            → registrations + auth alert + usage
 * POST   /openrouter-connections            → create   (premium entitlement)
 * PUT    /openrouter-connections/:id        → update   (premium entitlement)
 * POST   /openrouter-connections/:id/test   → probe    (premium entitlement)
 * DELETE /openrouter-connections/:id        → remove
 */
import type { Context, Hono } from 'hono';
import type { HonoEnv } from '../../../env';
import { parseOptionalBody } from '../requestBody';
import { OpenRouterConnectionBody, OpenRouterConnectionUpdateBody } from '../llmRoutes.schemas';
import {
  deleteOpenRouterConnection,
  listOpenRouterConnections,
  openRouterConnectionUsage,
  upsertOpenRouterConnection,
  USAGE_WINDOW_DAYS,
  type OpenRouterConnectionUsage,
} from '../../../application/llm/openRouterConnectionService';
import { clearConnectionAuthAlert, loadConnectionAuthAlert } from '../../../application/llm/providerAuthAlerts';
import { probeOpenRouterConnection } from '../../../application/llm/byoCredentialHealth';
import { toTenantPlan } from '../../../application/tenant/featureEntitlements';
import { evaluatePremiumModelAccess, premiumModelGateBody } from '../../../domain/tenant/planFeatures';
import { requireTenantAccess, respondToAccessError, type TenantAccess } from './access';

/**
 * Premium entitlement for the OpenRouter connection surface. Creating, editing and
 * TESTING a registration all spend the same paid capability — a test is a real (tiny)
 * upstream dispatch, and on a managed-key connection it is OUR key that pays for it — so
 * the gate is defined once here instead of being re-derived per route.
 */
function requireOpenRouterEntitlement(c: Context<HonoEnv>, access: TenantAccess): Response | null {
  const premium = evaluatePremiumModelAccess({
    effectivePlan: toTenantPlan(access.effectivePlan),
    premiumOverride: access.premiumOverride,
    isSuperadmin: access.isSuperadmin,
    cardValidated: access.cardValidated,
  });
  return premium.entitled ? null : c.json(premiumModelGateBody(premium), 402);
}

export function mountOpenRouterConnectionRoutes(router: Hono<HonoEnv>): void {
  router.get('/openrouter-connections', async (c) => {
    let access: TenantAccess;
    try { access = await requireTenantAccess(c); } catch (err) { return respondToAccessError(c, err); }
    const connections = await listOpenRouterConnections(c.env, access.tenantId);
    // Attach the rejected-account notice for the same reason the provider LIST does: a
    // registration whose key was revoked or ran out of credit looks identical to a healthy
    // one here, and an operator who never clicks Test would never find out. Bounded fan-out
    // (≤20 connections) and each lookup is read-through cached.
    //
    // Usage rides the same read (ONE grouped scan for the whole tenant, 60s read-through) so
    // "is it working" and "is it being used" are answered together — a registration that is
    // healthy and has served nothing in 30 days is its own kind of problem, and until now
    // this surface reported neither number.
    const [alerts, usage] = await Promise.all([
      Promise.all(connections.map((connection) =>
        loadConnectionAuthAlert(c.env, access.tenantId, connection.id).catch(() => null))),
      openRouterConnectionUsage(c.env, access.tenantId, connections)
        .catch((): Record<number, OpenRouterConnectionUsage> => ({})),
    ]);
    return c.json({
      connections: connections.map((connection, i) => ({
        ...connection,
        ...(alerts[i] ? { authAlert: alerts[i] } : {}),
        ...(usage[connection.id] ? { usage: usage[connection.id] } : {}),
      })),
      usageWindowDays: USAGE_WINDOW_DAYS,
    });
  });

  router.post('/openrouter-connections', async (c) => {
    let access: TenantAccess;
    try { access = await requireTenantAccess(c); } catch (err) { return respondToAccessError(c, err); }
    const gated = requireOpenRouterEntitlement(c, access);
    if (gated) return gated;
    const body = await parseOptionalBody(c, OpenRouterConnectionBody);
    const result = await upsertOpenRouterConnection(c.env, access.tenantId, {
      label: typeof body.label === 'string' ? body.label : '',
      models: Array.isArray(body.models) ? body.models.filter((m: unknown): m is string => typeof m === 'string') : [],
      ...(typeof body.apiKey === 'string' ? { apiKey: body.apiKey } : {}),
    }, access.userId);
    if (!result.ok) {
      const status = result.reason === 'duplicate_label' ? 409 : 400;
      return c.json({ error: result.reason, code: result.reason }, status);
    }
    return c.json(result.connection, 201);
  });

  router.put('/openrouter-connections/:id', async (c) => {
    let access: TenantAccess;
    try { access = await requireTenantAccess(c); } catch (err) { return respondToAccessError(c, err); }
    const gated = requireOpenRouterEntitlement(c, access);
    if (gated) return gated;
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid connection id' }, 400);
    const body = await parseOptionalBody(c, OpenRouterConnectionUpdateBody);
    const result = await upsertOpenRouterConnection(c.env, access.tenantId, {
      id,
      label: typeof body.label === 'string' ? body.label : '',
      models: Array.isArray(body.models) ? body.models.filter((m: unknown): m is string => typeof m === 'string') : [],
      ...(typeof body.apiKey === 'string' ? { apiKey: body.apiKey } : {}),
      ...(body.clearKey === true ? { clearKey: true } : {}),
    }, access.userId);
    if (!result.ok) {
      const status = result.reason === 'not_found' ? 404 : result.reason === 'duplicate_label' ? 409 : 400;
      return c.json({ error: result.reason, code: result.reason }, status);
    }
    // An edited registration — a replaced key, a corrected model list — invalidates the old
    // rejection notice, exactly as replacing a provider key does. Otherwise the card keeps
    // telling the operator to fix something they just fixed.
    await clearConnectionAuthAlert(c.env, access.tenantId, id);
    return c.json(result.connection);
  });

  // Test ONE registration by actually dispatching a tiny strict-pinned request down its own
  // model list, on its own key when it has one. The provider cards have had this since the
  // day a page of green "connected" chips sat next to a failing Test button; a registration
  // is exactly as capable of being silently broken (a rotated OpenRouter key, a model id
  // that OpenRouter retired), and until now nothing on this surface could tell an operator
  // so. Same verdict shape, same probe module — see `probeOpenRouterConnection`.
  router.post('/openrouter-connections/:id/test', async (c) => {
    let access: TenantAccess;
    try { access = await requireTenantAccess(c); } catch (err) { return respondToAccessError(c, err); }
    const gated = requireOpenRouterEntitlement(c, access);
    if (gated) return gated;
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid connection id' }, 400);
    const probe = await probeOpenRouterConnection(c.env, access.tenantId, id);
    if (probe.status === 'not_found') return c.json({ error: 'not_found', code: 'not_found' }, 404);
    if (probe.ok) {
      return c.json({
        ok: true, status: probe.status, model: probe.model, ownKey: probe.ownKey,
        ...(probe.limitedModels?.length ? { limitedModels: probe.limitedModels } : {}),
        testedAt: probe.checkedAt,
      });
    }
    // An upstream 5xx means the OPPOSITE of a broken registration: the key was accepted and
    // the model provider then errored. Reporting that as "test failed" sends an owner to
    // re-enter a key that is fine — so it gets its own sentence naming the model, the status
    // and the fact that their credential worked.
    const account = probe.ownKey ? 'your OpenRouter key' : 'Builderforce managed billing';
    return c.json({
      ok: false,
      status: probe.status,
      model: probe.model,
      ownKey: probe.ownKey,
      error: probe.status === 'upstream_error'
        ? `${account} worked — OpenRouter accepted it and routed the request. The model provider then returned HTTP ${probe.upstreamStatus} for ${probe.model}, twice. That is an upstream outage on that model, not a problem with this connection: retry shortly, or put a different model first in this registration.`
        : probe.error
          ? `OpenRouter connection test failed: ${probe.error}`
          : `OpenRouter connection test could not run: ${probe.status.replaceAll('_', ' ')}.`,
      code: 'openrouter_connection_test_failed',
      testedAt: probe.checkedAt,
      ...(probe.limitedModels?.length ? { limitedModels: probe.limitedModels } : {}),
      // Echo the alert the probe just persisted so the card repaints from THIS response
      // instead of waiting for the list read's cache window to lapse.
      ...(probe.alert ? { authAlert: probe.alert } : {}),
      // Same redacted evidence the provider test returns — one probe module, one shape.
      ...(probe.diagnostic ? { diagnostic: probe.diagnostic } : {}),
      details: { connectionId: probe.connectionId, model: probe.model, upstreamStatus: probe.upstreamStatus },
    });
  });

  router.delete('/openrouter-connections/:id', async (c) => {
    let access: TenantAccess;
    try { access = await requireTenantAccess(c); } catch (err) { return respondToAccessError(c, err); }
    const id = Number(c.req.param('id'));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'invalid connection id' }, 400);
    const deleted = await deleteOpenRouterConnection(c.env, access.tenantId, id);
    // Nothing left to fix — retire the alert with the registration.
    if (deleted) await clearConnectionAuthAlert(c.env, access.tenantId, id);
    return deleted ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
  });
}
