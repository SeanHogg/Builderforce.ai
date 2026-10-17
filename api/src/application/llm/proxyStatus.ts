/**
 * `/v1/models` pool status — per-model cooldown, key-bound and capability info.
 * Split out of `LlmProxyService.ts` (the facade's `status()` delegates here).
 */

import {
  strictSchemaSupport,
  vendorForModel,
  vendorKeyBound,
  type AiCapability,
  type SchemaSupport,
  type VendorId,
} from './vendors';
import { capabilitiesForModel } from './poolRouting';
import { loadCooldownExpiries, loadCooledVendorExpiries } from '../../infrastructure/auth/cooldownStore';
import type { ProxyRuntime } from './proxyConfig';

export interface ProxyModelStatus {
  model: string;
  preferred: boolean;
  available: boolean;
  cooldownUntil?: number;
  vendor: VendorId;
  vendorCooledUntil?: number;
  keyBound: boolean;
  capabilities: AiCapability[];
  strictSchema: SchemaSupport;
}

/** Per-model status with cooldown + key-bound info — used by /v1/models.
 *  `capabilities` lets SDK consumers discover image/PDF-reading models
 *  (`vision` / `ocr`) and tool/structured-output support without hard-coding ids. */
export async function proxyModelStatus({ cfg, funding }: Pick<ProxyRuntime, 'cfg' | 'funding'>): Promise<ProxyModelStatus[]> {
  const env = funding.vendorEnv();
  const poolVendors = Array.from(new Set(cfg.modelPool.map((m) => vendorForModel(m))));
  const [cooledMap, vendorCooledMap] = await Promise.all([
    // `'display'` mode (not the default `'gate'`) so a model still inside its
    // cooldown TTL but past its `trialAfter` half-open instant ([1235]) keeps
    // reporting its full `until` — the admin UI can show the "cooling, probing"
    // countdown for that ~5-min tail instead of flipping to `available:true`.
    loadCooldownExpiries(cfg.env, cfg.modelPool.map((m) => ({ vendor: vendorForModel(m), model: m })), 'display'),
    loadCooledVendorExpiries(cfg.env, poolVendors),
  ]);
  return cfg.modelPool.map((model, i) => {
    const vendor      = vendorForModel(model);
    const until       = cooledMap.get(`${vendor}/${model}`);
    const vendorUntil = vendorCooledMap.get(vendor);
    const keyBound    = vendorKeyBound(env, vendor);
    return {
      model,
      vendor,
      preferred: i < cfg.preferredPoolSize,
      keyBound,
      available: keyBound && vendorUntil === undefined && until === undefined,
      capabilities: capabilitiesForModel(model),
      // What this model's constrained-decoding engine will actually accept for a
      // strict `response_format: json_schema`. Advertised so a consumer can pick
      // loose `json_object` up front instead of discovering the ceiling from a
      // `schema_too_complex` 400 — which is what "consumer migration" meant.
      strictSchema: strictSchemaSupport(model),
      ...(until       !== undefined && until       > 0 ? { cooldownUntil:       until       } : {}),
      ...(vendorUntil !== undefined && vendorUntil > 0 ? { vendorCooledUntil:   vendorUntil } : {}),
    };
  });
}
