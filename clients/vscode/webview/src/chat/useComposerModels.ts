/**
 * Which models this tenant may run, which one is in force, and WHO PAYS for it —
 * everything the `/` menu needs to both SHOW and CHANGE the model without leaving the
 * panel — plus the stall-failover selector the run loop reads over the same surface.
 *
 * Lifted out of the chat surface: it is a pure function of `init` and the bearer
 * fetch, and the surface only consumes its results.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadGatewayModelOptions, nextFallbackModel, type GatewayModelOptions } from '@seanhogg/builderforce-brain-embedded';
import type { ChatModelSelection, PromptOptionsLabels } from '@seanhogg/builderforce-brain-ui';
import type { AuthedFetch } from '../authedFetch';
import { post, type InitData } from '../vscodeBridge';

export function useComposerModels(
  init: InitData,
  apiReq: AuthedFetch,
  paidCostDetail: PromptOptionsLabels['paidCostDetail'],
) {
  // A BYO tenant connects their own provider key precisely so their turns stop drawing
  // on the plan, so the funding line rides every row. Cached per base URL (see
  // brain-embedded's gatewayModels.ts, shared with Rovr); any failure degrades to "auto only".
  const [modelChoices, setModelChoices] = useState<GatewayModelOptions | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadGatewayModelOptions(apiReq, init.baseUrl, { paidCostDetail })
      .then((r) => { if (!cancelled) setModelChoices(r); })
      .catch(() => { /* best-effort — the menu falls back to Auto */ });
    return () => { cancelled = true; };
  }, [apiReq, init.baseUrl, paidCostDetail]);
  const modelSurface = modelChoices?.surface ?? null;

  /**
   * The gateway catalogue plus this machine's own models. A merge rather than another
   * fetch: the gateway cannot know what a runtime on this laptop serves, and the
   * catalogue is unavailable precisely when on-device models matter most (signed out,
   * offline) — so local models also stand the menu up on their own. The placeholder
   * identity is NOT an entitlement verdict: the menu is told it is pending.
   */
  const composerModels = useMemo<GatewayModelOptions>(() => {
    const local = init.localModels ?? [];
    if (!modelChoices) {
      return {
        surface: {},
        options: { byo: [], free: [], plan: [], paid: [], local },
        identity: { product: 'free', canChoose: false },
      };
    }
    return local.length === 0 ? modelChoices : { ...modelChoices, options: { ...modelChoices.options, local } };
  }, [modelChoices, init.localModels]);

  // The user's CHOICE, reconstructed from what the host resolved: a strict pin, the
  // BYO pool, or auto (in which case `init.model` is whatever auto landed on).
  const modelSelection = useMemo<ChatModelSelection>(
    () => (init.modelStrict && init.model
      ? { mode: 'model', model: init.model }
      : init.routingMode === 'byo_pool' ? { mode: 'byo_pool' } : { mode: 'auto' }),
    [init.model, init.modelStrict, init.routingMode],
  );
  // Host state (it drives BOTH editor chat surfaces and survives this panel): the pick
  // crosses the bridge and the host re-posts `init`.
  const chooseModel = useCallback((selection: ChatModelSelection) => {
    post('model.set', selection.mode === 'model' ? { mode: 'model', model: selection.model } : { mode: selection.mode });
  }, []);

  // Tool-call failover: the SHARED selector over the surface above, so "which model
  // next" is decided in one place for every host.
  const pickFallbackModel = useCallback(
    (tried: readonly string[]) => nextFallbackModel(modelSurface, tried),
    [modelSurface],
  );

  return { catalogLoaded: modelChoices != null, modelSurface, composerModels, modelSelection, chooseModel, pickFallbackModel };
}
