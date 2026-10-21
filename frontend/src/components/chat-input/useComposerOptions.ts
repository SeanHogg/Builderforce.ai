// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useMemo } from 'react';
import { composerModel, useComposerMenuRequest, type ComposerOptions } from '@seanhogg/builderforce-brain-ui';
import { browserLocalModelStore } from '@/lib/brain/localModelStore';
import { useWebInferenceMode } from '@/lib/localFirst/useWebInferenceMode';
import type { ChatInputProps } from './types';

export type ComposerOptionProps = Pick<ChatInputProps,
  | 'effort' | 'onEffortChange' | 'effortMinAnswerTokens' | 'thinking' | 'onThinkingChange'
  | 'modelSelection' | 'modelOptions' | 'onModelSelectionChange' | 'effectiveModel' | 'modelIdentity' | 'composerId'
  | 'chatMode' | 'onChatModeChange' | 'memoryEnabled' | 'onMemoryChange' | 'memoryUnavailableReason'
  | 'canConsolidate' | 'consolidating' | 'forking' | 'onConsolidate' | 'onFork'
  | 'autoMode' | 'onAutoModeChange'
>;

/**
 * The composer's flat run-shaping props → the shared `ComposerOptions` contract the
 * `/` Work panel is built from. Each section is offered only when its host wires the
 * handler — the same rule the menu always had.
 */
export function useComposerOptions(p: ComposerOptionProps): ComposerOptions {
  const {
    effort, onEffortChange, effortMinAnswerTokens, thinking, onThinkingChange,
    modelSelection, modelOptions, onModelSelectionChange, effectiveModel, modelIdentity, composerId,
    chatMode, onChatModeChange, memoryEnabled, onMemoryChange, memoryUnavailableReason,
    canConsolidate = false, consolidating = false, forking = false, onConsolidate, onFork,
    autoMode, onAutoModeChange,
  } = p;
  // Where models run (Hybrid · Local only · Specific) rides the Model tab, so it is offered
  // wherever a model is: the surfaces that run Brain turns. Signed in and never asked,
  // the composer asks once before the next turn (`needsChoice`).
  const inference = useWebInferenceMode();
  // "Download a local model" / "Pick a model" (the error banner beside THIS composer)
  // asks this menu — and only this one — to open on its Model tab.
  const openMenu = useComposerMenuRequest(composerId);
  const offersModel = !!(onModelSelectionChange && modelOptions && modelSelection);
  return useMemo<ComposerOptions>(() => ({
    ...(chatMode && onChatModeChange ? { mode: { value: chatMode, onChange: onChatModeChange } } : {}),
    // A reason given ⇒ no project memory stands behind the chat: the row shows, inert,
    // and says why (the host's sentence rides the composer copy).
    ...(onMemoryChange ? { memory: { enabled: !!memoryEnabled, onChange: onMemoryChange, available: !memoryUnavailableReason } } : {}),
    ...(onEffortChange ? { effort: { value: effort ?? 'balanced', onChange: onEffortChange, minAnswerTokens: effortMinAnswerTokens } } : {}),
    ...(onThinkingChange ? { thinking: { value: !!thinking, onChange: onThinkingChange } } : {}),
    ...(onModelSelectionChange && modelOptions && modelSelection
      ? {
          // brain-ui's ONE Model-section builder (the editor and Rovr build theirs there too).
          model: composerModel({
            catalog: { options: modelOptions, identity: modelIdentity },
            selection: modelSelection,
            onChange: onModelSelectionChange,
            effective: effectiveModel,
            // The page engines' store is the on-device list's port: models downloaded
            // into THIS browser (WebGPU `bfi`, WebLLM) are listed, fetched and pinned here.
            localStore: browserLocalModelStore,
            // The web reads its catalogue through `useChatModelOptions`, whose identity is
            // the account's own verdict — never a pending placeholder.
            identityPending: false,
          }),
        }
      : {}),
    ...(offersModel
      ? {
          inferenceMode: { value: inference.value, onChange: inference.onChange, needsChoice: inference.needsChoice },
          ...(openMenu ? { openMenu } : {}),
        }
      : {}),
    ...(onAutoModeChange ? { autoMode: { enabled: !!autoMode, onChange: onAutoModeChange } } : {}),
    ...(onConsolidate && onFork ? { session: { canConsolidate, consolidating, forking, onConsolidate, onFork } } : {}),
  }), [
    effort, onEffortChange, effortMinAnswerTokens, thinking, onThinkingChange,
    modelSelection, modelOptions, onModelSelectionChange, effectiveModel, modelIdentity,
    chatMode, onChatModeChange, memoryEnabled, onMemoryChange, memoryUnavailableReason,
    canConsolidate, consolidating, forking, onConsolidate, onFork, autoMode, onAutoModeChange,
    offersModel, inference, openMenu,
  ]);
}
