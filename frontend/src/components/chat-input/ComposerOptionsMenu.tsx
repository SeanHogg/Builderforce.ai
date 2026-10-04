import { memo, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PromptOptionsMenu } from '@seanhogg/builderforce-brain-ui';
import { effortProfile } from '@seanhogg/builderforce-brain-embedded';
import { CHAT_MODES, CHAT_MODE_ICON, type BrainEffort, type ChatMode } from '@/lib/brain';
import { useComposerOptionLabels } from './useComposerOptionLabels';
import type { ChatInputProps } from './types';

export type ComposerOptionsMenuProps = Pick<ChatInputProps,
  | 'effort' | 'onEffortChange' | 'thinking' | 'onThinkingChange' | 'accountSettingsHref'
  | 'modelSelection' | 'modelOptions' | 'onModelSelectionChange' | 'effectiveModel' | 'modelIdentity'
  | 'chatMode' | 'onChatModeChange' | 'memoryEnabled' | 'onMemoryChange' | 'memoryUnavailableReason'
  | 'canConsolidate' | 'consolidating' | 'forking' | 'onConsolidate' | 'onFork'
  | 'autoMode' | 'onAutoModeChange'
> & { disabled: boolean };

/**
 * `/` : effort, thinking, WHICH MODEL IS RUNNING and how to change it,
 * and account settings — the one shared control, so this composer can
 * never grow a second "which model" chip beside it again.
 *
 * Each section is offered only when the host wires its handler; this component
 * turns the composer's flat props into the shared menu's grouped ones.
 */
export const ComposerOptionsMenu = memo(function ComposerOptionsMenu({
  disabled,
  effort,
  onEffortChange,
  thinking,
  onThinkingChange,
  accountSettingsHref,
  modelSelection,
  modelOptions,
  onModelSelectionChange,
  effectiveModel,
  modelIdentity,
  chatMode,
  onChatModeChange,
  memoryEnabled,
  onMemoryChange,
  memoryUnavailableReason,
  canConsolidate = false,
  consolidating = false,
  forking = false,
  onConsolidate,
  onFork,
  autoMode,
  onAutoModeChange,
}: ComposerOptionsMenuProps) {
  const t = useTranslations('chatInput');
  const tModes = useTranslations('brain.modes');
  const router = useRouter();
  const optionLabels = useComposerOptionLabels();

  // Chat | Work, built from the SHARED mode list so a mode cannot exist in the
  // vocabulary and be missing from the control that arms it.
  const modeChoices = useMemo(
    () => CHAT_MODES.map((mode) => ({ value: mode, label: tModes(`${mode}.label`), hint: tModes(`${mode}.hint`), icon: CHAT_MODE_ICON[mode] })),
    [tModes],
  );
  const describeMemory = useCallback((on: boolean) => t(on ? 'memoryOnHint' : 'memoryOffHint'), [t]);

  // What each control really costs, read from the SHARED effort table so the copy
  // can never promise a budget the request does not send.
  const describeEffort = useCallback((level: BrainEffort) => {
    const { maxTokens, thinkingBudgetTokens } = effortProfile(level);
    const base = t(`effortDesc_${level}`, { answer: maxTokens });
    return thinking ? `${base} ${t('effortDescThinking', { thinking: thinkingBudgetTokens })}` : base;
  }, [t, thinking]);
  const describeThinking = useCallback(
    (on: boolean) => (on
      ? t('thinkingOnDesc', { budget: effortProfile(effort ?? 'balanced').thinkingBudgetTokens })
      : t('thinkingOffDesc')),
    [t, effort],
  );

  const mode = useMemo(
    () => (chatMode && onChatModeChange ? { value: chatMode, onChange: (next: string) => onChatModeChange(next as ChatMode), choices: modeChoices } : undefined),
    [chatMode, onChatModeChange, modeChoices],
  );
  const memory = useMemo(
    () => (onMemoryChange ? { enabled: !!memoryEnabled, onChange: onMemoryChange, unavailableReason: memoryUnavailableReason, describe: describeMemory } : undefined),
    [onMemoryChange, memoryEnabled, memoryUnavailableReason, describeMemory],
  );
  const autoModeOption = useMemo(
    () => (onAutoModeChange ? { enabled: !!autoMode, onChange: onAutoModeChange, description: t('autoModeHint') } : undefined),
    [onAutoModeChange, autoMode, t],
  );
  const session = useMemo(
    () => (onConsolidate && onFork ? { canConsolidate, consolidating, forking, onConsolidate, onFork } : undefined),
    [onConsolidate, onFork, canConsolidate, consolidating, forking],
  );
  const model = useMemo(
    () => (onModelSelectionChange && modelOptions && modelSelection
      ? { selection: modelSelection, options: modelOptions, onChange: onModelSelectionChange, effective: effectiveModel, identity: modelIdentity }
      : undefined),
    [onModelSelectionChange, modelOptions, modelSelection, effectiveModel, modelIdentity],
  );
  const openAccountSettings = useCallback(() => {
    if (accountSettingsHref) router.push(accountSettingsHref);
  }, [router, accountSettingsHref]);

  return (
    <PromptOptionsMenu
      labels={optionLabels}
      disabled={disabled}
      mode={mode}
      memory={memory}
      autoMode={autoModeOption}
      session={session}
      effort={effort}
      onEffortChange={onEffortChange}
      describeEffort={describeEffort}
      thinking={thinking}
      onThinkingChange={onThinkingChange}
      describeThinking={describeThinking}
      model={model}
      onAccountSettings={accountSettingsHref ? openAccountSettings : undefined}
    />
  );
});
