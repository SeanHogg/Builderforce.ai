'use client';

import { useEffect, useState } from 'react';
import { llmApi, tenantModelApi, type TenantModel } from './builderforceApi';

/**
 * Shared loader for the gateway model list. `models` is the full plan pool;
 * `codingModels` is the curated tool-calling + coding subset (what a cloud-agent
 * run / an agent's base model should pick from); `tenantModels` is the tenant's
 * own named "LLM" configs (migration 0211), selectable anywhere by their
 * `tenant_model:<slug>` ref. One source for every consumer — the run picker, the
 * cloud-agent form, AND the Designer Brain — so they never present different lists.
 *
 * Module-level promise cache: the endpoints are hit once per tab and shared across
 * every mount, instead of each component re-fetching the same stable lists.
 */
export interface LlmModelLists {
  models: string[];
  codingModels: string[];
  /** The tenant's named model configs ("LLMs"). */
  tenantModels: TenantModel[];
  /** True when the tenant is on a paid plan (Pro/Teams) or has a premium override.
   *  Kept for callers that specifically mean "is on a paid plan". For the model
   *  picker gate use {@link canChooseModel} instead (BYO also unlocks choice). */
  isPaid: boolean;
  /** Pinnable models the tenant's connected providers (BYO) can serve, as
   *  `<vendor>/<id>` refs — the model choices follow the connected providers. */
  byoModels: string[];
  /** True when the tenant may pick a model at all: a paid plan OR at least one
   *  connected provider (BYO). The authoritative gate the server enforces in
   *  `pickCloudModel` / the strict-pin gate — this is the UI mirror. */
  canChooseModel: boolean;
}

const EMPTY: LlmModelLists = { models: [], codingModels: [], tenantModels: [], isPaid: false, byoModels: [], canChooseModel: false };

let cache: LlmModelLists | null = null;
let inflight: Promise<LlmModelLists> | null = null;

function load(): Promise<LlmModelLists> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = Promise.all([
      llmApi.models(),
      // Tenant models are tenant-scoped + optional; a failure must not block the pool.
      tenantModelApi.list().then((r) => r.models).catch(() => [] as TenantModel[]),
    ])
      .then(([res, tenantModels]) => {
        const models = 'data' in res ? res.data.map((m) => m.model) : res.models;
        const isPaid = res.premium === true || res.effectivePlan !== 'free';
        const byoModels = res.byo?.models.map((m) => m.id) ?? [];
        // Server sends canChooseModel; fall back to isPaid || has-BYO for older payloads.
        const canChooseModel = res.canChooseModel ?? (isPaid || byoModels.length > 0);
        cache = { models: models ?? [], codingModels: res.codingModels ?? [], tenantModels, isPaid, byoModels, canChooseModel };
        return cache;
      })
      .catch(() => {
        inflight = null; // allow a later retry after a transient failure
        return EMPTY;
      });
  }
  return inflight;
}

/** Drop the module cache so the next mount re-fetches (call after creating/editing
 *  a tenant model, so freshly-saved "LLMs" show up in every picker). */
export function invalidateLlmModels(): void {
  cache = null;
  inflight = null;
}

export function useLlmModels(): LlmModelLists {
  const [state, setState] = useState<LlmModelLists>(cache ?? EMPTY);
  useEffect(() => {
    let alive = true;
    load().then((r) => { if (alive) setState(r); });
    return () => { alive = false; };
  }, []);
  return state;
}
