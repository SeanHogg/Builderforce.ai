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
  /** Models eligible to be a FRONTIER TEACHER (distil into an Evermind): the tenant's
   *  OWN connected BYO frontier models FIRST (a BYO-Anthropic tenant teaches with
   *  Opus/Sonnet on their account), plus the platform's premium coders when the platform
   *  funds frontier (paid/override/superadmin). Empty when the tenant has no frontier
   *  access. Use THIS for the teacher picker — NOT `codingModels` (the plan pool, which
   *  is free coders on the free plan). */
  teacherModels: string[];
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
  /** True when the tenant may use FRONTIER / premium models (teach/distil from a top
   *  model, pick a premium model): superadmin OR premium override OR a connected BYO
   *  account OR a paid plan. The single server rule (`evaluateFrontierAccess`) — use
   *  THIS (not `isPaid`) for any "requires a paid plan to use a frontier model" gate,
   *  so a superadmin or a BYO tenant is never shown a false paywall. */
  canUseFrontierModels: boolean;
}

const EMPTY: LlmModelLists = { models: [], codingModels: [], teacherModels: [], tenantModels: [], isPaid: false, byoModels: [], canChooseModel: false, canUseFrontierModels: false };

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
        // Frontier access = the server's unified rule (superadmin || override || BYO ||
        // paid). Falls back to canChooseModel for older payloads (which already folds
        // BYO + paid; only the direct-superadmin case is newly server-side).
        const canUseFrontierModels = res.canUseFrontierModels ?? canChooseModel;
        // Teacher-eligible frontier models. Older payloads (no teacherModels) fall back to
        // BYO models ∪ coding pool so a BYO tenant still sees their own frontier models.
        const teacherModels = res.teacherModels
          ?? (canUseFrontierModels ? Array.from(new Set([...byoModels, ...(res.codingModels ?? [])])) : []);
        cache = { models: models ?? [], codingModels: res.codingModels ?? [], teacherModels, tenantModels, isPaid, byoModels, canChooseModel, canUseFrontierModels };
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
