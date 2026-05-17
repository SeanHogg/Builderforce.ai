/**
 * Per-vendor health probe — shared by:
 *   - POST /api/admin/llm-health/:vendor (manual button)
 *   - scheduled() cron handler (daily run, emails superadmins on status change)
 *
 * For each model in the vendor's catalog, send a 1-token chat completion and
 * record the outcome. Output is summarised into `status` for fast UI rendering:
 *   - ok            — every probed model returned 200 + non-empty content
 *   - degraded      — some succeeded, some failed
 *   - down          — every probed model failed
 *   - unconfigured  — vendor API key is not bound in env
 *
 * Cost: N calls per vendor per run (where N = catalog size). Each call is
 * `max_completion_tokens: 1` so the spend is dominated by overhead, not output.
 */

import {
  getModule,
  vendorKeyBound,
  VendorFatalError,
  VendorRetryableError,
  type VendorEnv,
  type VendorId,
} from './vendors';

export type VendorHealthStatus = 'ok' | 'degraded' | 'down' | 'unconfigured';

export interface ModelProbeResult {
  model: string;
  ok: boolean;
  status: number;
  latencyMs: number;
  error?: string;
}

export interface VendorProbeResult {
  vendor: VendorId;
  status: VendorHealthStatus;
  probedCount: number;
  okCount: number;
  failedCount: number;
  latencyMs: number;
  models: ModelProbeResult[];
}

const PROBE_MESSAGES: Array<Record<string, unknown>> = [
  { role: 'user', content: 'ping' },
];

/** One probe call against a single vendor+model. */
async function probeModel(
  env: VendorEnv,
  vendor: VendorId,
  modelId: string,
): Promise<ModelProbeResult> {
  const mod    = getModule(vendor);
  const apiKey = mod.apiKeyFrom(env);
  if (!apiKey) {
    return { model: modelId, ok: false, status: 0, latencyMs: 0, error: 'no api key' };
  }

  const t0 = Date.now();
  try {
    const result = await mod.call({
      apiKey,
      model: modelId,
      messages: PROBE_MESSAGES,
      maxTokens: 1,
      temperature: 0,
      title: 'Builderforce health probe',
    });
    const latencyMs = Date.now() - t0;
    // Empty-but-200 (content === '' with no tool_calls) is *fine* for a probe —
    // we don't need real content, we just need to know the upstream accepted
    // the call. So success is "no throw + no fatal error".
    void result;
    return { model: modelId, ok: true, status: 200, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - t0;
    if (err instanceof VendorRetryableError || err instanceof VendorFatalError) {
      return {
        model: modelId,
        ok: false,
        status: err.status,
        latencyMs,
        error: err.message.slice(0, 240),
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { model: modelId, ok: false, status: 0, latencyMs, error: msg.slice(0, 240) };
  }
}

/** Probe every model in a vendor's catalog in parallel. */
export async function probeVendor(env: VendorEnv, vendor: VendorId): Promise<VendorProbeResult> {
  const mod = getModule(vendor);

  if (!vendorKeyBound(env, vendor)) {
    return {
      vendor,
      status: 'unconfigured',
      probedCount: 0,
      okCount: 0,
      failedCount: 0,
      latencyMs: 0,
      models: [],
    };
  }

  const models = await Promise.all(
    mod.catalog.map((entry) => probeModel(env, vendor, entry.id)),
  );

  const okCount     = models.filter((m) => m.ok).length;
  const failedCount = models.length - okCount;
  const latencyMs   = models.reduce((acc, m) => Math.max(acc, m.latencyMs), 0);

  let status: VendorHealthStatus;
  if (models.length === 0)        status = 'unconfigured';
  else if (okCount === 0)         status = 'down';
  else if (failedCount === 0)     status = 'ok';
  else                            status = 'degraded';

  return {
    vendor,
    status,
    probedCount: models.length,
    okCount,
    failedCount,
    latencyMs,
    models,
  };
}

/** Probe every registered vendor in parallel — used by the scheduled() cron. */
export async function probeAllVendors(
  env: VendorEnv,
  vendors: readonly VendorId[],
): Promise<VendorProbeResult[]> {
  return Promise.all(vendors.map((v) => probeVendor(env, v)));
}
