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
}

const EMPTY: LlmModelLists = { models: [], codingModels: [] };

let cache: LlmModelLists | null = null;
let inflight: Promise<LlmModelLists> | null = null;

function load(): Promise<LlmModelLists> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = llmApi.models()
      .then((res) => {
        const models = 'data' in res ? res.data.map((m) => m.model) : res.models;
        cache = { models: models ?? [], codingModels: res.codingModels ?? [] };
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
