// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useMemo } from 'react';
import { composerModel, type ComposerOptions } from '@seanhogg/builderforce-brain-ui';
import { browserLocalModelStore } from '@/lib/brain/localModelStore';
import type { ChatInputProps } from './types';

export type ComposerOptionProps = Pick<ChatInputProps,
  | 'effort' | 'onEffortChange' | 'effortMinAnswerTokens' | 'thinking' | 'onThinkingChange'
  | 'modelSelection' | 'modelOptions' | 'onModelSelectionChange' | 'effectiveModel' | 'modelIdentity'
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
    modelSelection, modelOptions, onModelSelectionChange, effectiveModel, modelIdentity,
    chatMode, onChatModeChange, memoryEnabled, onMemoryChange, memoryUnavailableReason,
    canConsolidate = false, consolidating = false, forking = false, onConsolidate, onFork,
    autoMode, onAutoModeChange,
  } = p;
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
    ...(onAutoModeChange ? { autoMode: { enabled: !!autoMode, onChange: onAutoModeChange } } : {}),
    ...(onConsolidate && onFork ? { session: { canConsolidate, consolidating, forking, onConsolidate, onFork } } : {}),
  }), [
    effort, onEffortChange, effortMinAnswerTokens, thinking, onThinkingChange,
    modelSelection, modelOptions, onModelSelectionChange, effectiveModel, modelIdentity,
    chatMode, onChatModeChange, memoryEnabled, onMemoryChange, memoryUnavailableReason,
    canConsolidate, consolidating, forking, onConsolidate, onFork, autoMode, onAutoModeChange,
  ]);
}
