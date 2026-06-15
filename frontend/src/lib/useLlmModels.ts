'use client';

import { useEffect, useState } from 'react';
import { llmApi } from './builderforceApi';

/**
 * Shared loader for the gateway model list. `models` is the full plan pool;
 * `codingModels` is the curated tool-calling + coding subset (what a cloud-agent
 * run / an agent's base model should pick from). One source for every consumer —
 * the run picker AND the cloud-agent form — so they never present different lists.
 *
 * Module-level promise cache: the endpoint is hit once per tab and shared across
 * every mount, instead of each component re-fetching the same stable list.
 */
export interface LlmModelLists {
  models: string[];
  codingModels: string[];
  /** True when the tenant is on a paid plan (Pro/Teams) or has a premium override.
   *  Drives whether the run-time model picker is offered: only paid plans may
   *  choose the model (free plans run Builderforce's managed default). The server
   *  enforces this independently in `pickCloudModel` — this is the UI gate. */
  isPaid: boolean;
}

const EMPTY: LlmModelLists = { models: [], codingModels: [], isPaid: false };

let cache: LlmModelLists | null = null;
let inflight: Promise<LlmModelLists> | null = null;

function load(): Promise<LlmModelLists> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = llmApi.models()
      .then((res) => {
        const models = 'data' in res ? res.data.map((m) => m.model) : res.models;
        const isPaid = res.premium === true || res.effectivePlan !== 'free';
        cache = { models: models ?? [], codingModels: res.codingModels ?? [], isPaid };
        return cache;
      })
      .catch(() => {
        inflight = null; // allow a later retry after a transient failure
        return EMPTY;
      });
  }
  return inflight;
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
