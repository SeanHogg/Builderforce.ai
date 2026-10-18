import { useCallback, useMemo } from 'react';
import { nextFallbackModel } from '@seanhogg/builderforce-brain-embedded';
import { useChatModelOptions, useLlmModels } from '@/lib/useLlmModels';
import { browserRunWindowSources } from '@/lib/brain/runWindowSources';
import type { useBrainAccountPreferences } from './useBrainAccountPreferences';

/**
 * The model side of the Brain panel's run: the shared (module-cached) model surface,
 * the composer's `/` menu options, the explicit pick, and the two things the run loop
 * needs from that surface — the tool-call failover selector and the window fit's
 * sources. Read ABOVE the conversation hook, which consumes them; the diagnostics
 * capture reads the same cached object.
 */
export function useBrainPanelModels(modelSelection: ReturnType<typeof useBrainAccountPreferences>['modelSelection']) {
  const llmModels = useLlmModels();
  const { options: modelOptions, identity: modelIdentity } = useChatModelOptions();
  const selectedModel = modelSelection.mode === 'model' ? modelSelection.model : undefined;
  // Tool-call failover: the SHARED selector over that surface, so "which model next"
  // is decided in one place for every host rather than per surface.
  const pickFallbackModel = useCallback(
    (tried: readonly string[]) => nextFallbackModel({ ...llmModels.fundingSurface, codingModels: llmModels.codingModels }, tried),
    [llmModels],
  );
  // The window fit's sources: a failover onto a smaller model is packed for its window.
  const windowSources = useMemo(() => browserRunWindowSources(llmModels.fundingSurface), [llmModels]);
  return { llmModels, modelOptions, modelIdentity, selectedModel, pickFallbackModel, windowSources };
}
