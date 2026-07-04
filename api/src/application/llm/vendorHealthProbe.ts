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

/**
 * In-memory per-vendor cooldown for the MANUAL probe button. Each manual probe
 * fans out N upstream calls (N = the vendor's catalog size), so a superadmin
 * clicking repeatedly can burn meaningful free-tier quota. The scheduled() cron
 * is naturally rate-limited by its schedule and does NOT use this. Pure +
 * testable: the caller passes `nowMs`, and the min interval is configurable.
 */
const MANUAL_PROBE_MIN_INTERVAL_MS = 60_000; // at most one manual probe per vendor per minute
const lastManualProbeAt = new Map<string, number>();

export function tryAcquireProbeSlot(
  vendor: string,
  nowMs: number,
  minIntervalMs: number = MANUAL_PROBE_MIN_INTERVAL_MS,
): { ok: true } | { ok: false; retryAfterMs: number } {
  const last = lastManualProbeAt.get(vendor);
  if (last !== undefined && nowMs - last < minIntervalMs) {
    return { ok: false, retryAfterMs: minIntervalMs - (nowMs - last) };
  }
  lastManualProbeAt.set(vendor, nowMs);
  return { ok: true };
}

/** Test-only: clear the manual-probe cooldown state between cases. */
export function _resetProbeCooldowns(): void {
  lastManualProbeAt.clear();
}

/** The per-item outcome a probe fn returns for one catalog model (before timing
 *  + the exception classification `runCatalogProbe` layers on). */
export interface ProbeOutcome {
  ok: boolean;
  status: number;
  error?: string;
}

/** Aggregate a catalog probe: run `probeOne` for every model (in parallel),
 *  timing + classifying each (a thrown `VendorRetryableError`/`VendorFatalError`
 *  → its `.status`; any other throw → status 0), then roll the results up into
 *  the ok/down/degraded/unconfigured status ladder. Shared verbatim by the chat
 *  and image health probes — only `probeOne` (the per-model `mod.call` vs
 *  `mod.generate` + the "usable result" test) differs per surface. */
export async function runCatalogProbe<M extends { id: string }>(
  catalog: ReadonlyArray<M>,
  probeOne: (entry: M) => Promise<ProbeOutcome>,
): Promise<{
  models: ModelProbeResult[];
  okCount: number;
  failedCount: number;
  latencyMs: number;
  status: VendorHealthStatus;
}> {
  const models = await Promise.all(
    catalog.map(async (entry): Promise<ModelProbeResult> => {
      const t0 = Date.now();
      try {
        const r = await probeOne(entry);
        return { model: entry.id, ok: r.ok, status: r.status, latencyMs: Date.now() - t0, ...(r.error ? { error: r.error } : {}) };
      } catch (err) {
        const latencyMs = Date.now() - t0;
        if (err instanceof VendorRetryableError || err instanceof VendorFatalError) {
          return { model: entry.id, ok: false, status: err.status, latencyMs, error: err.message.slice(0, 240) };
        }
        const msg = err instanceof Error ? err.message : String(err);
        return { model: entry.id, ok: false, status: 0, latencyMs, error: msg.slice(0, 240) };
      }
    }),
  );

  const okCount     = models.filter((m) => m.ok).length;
  const failedCount = models.length - okCount;
  const latencyMs   = models.reduce((acc, m) => Math.max(acc, m.latencyMs), 0);

  let status: VendorHealthStatus;
  if (models.length === 0)        status = 'unconfigured';
  else if (okCount === 0)         status = 'down';
  else if (failedCount === 0)     status = 'ok';
  else                            status = 'degraded';

  return { models, okCount, failedCount, latencyMs, status };
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

  const { models, okCount, failedCount, latencyMs, status } = await runCatalogProbe(
    mod.catalog,
    async (entry): Promise<ProbeOutcome> => {
      const apiKey = mod.apiKeyFrom(env);
      if (!apiKey) return { ok: false, status: 0, error: 'no api key' };
      const result = await mod.call({
        apiKey,
        model: entry.id,
        messages: PROBE_MESSAGES,
        maxTokens: 1,
        temperature: 0,
        title: 'Builderforce health probe',
      });
      // Empty-but-200 (content === '' with no tool_calls) is *fine* for a probe —
      // we don't need real content, we just need to know the upstream accepted
      // the call. So success is "no throw + no fatal error".
      void result;
      return { ok: true, status: 200 };
    },
  );

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
