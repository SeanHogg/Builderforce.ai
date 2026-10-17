/**
 * Rovr's prompt area — THE shared `BrainComposer` (the box, `+`, the `/` Work panel with
 * Mode, Effort, Model and Status) the web and the editor mount, bound to the side panel:
 * its options are the chat's device record (`useRovrChatOptions`), the Status tab reads
 * through the panel's API client when signed in, and an upgrade opens the web app's
 * pricing page in a tab.
 */
import { useMemo, type ReactNode } from 'react';
import { BrainComposer } from '@seanhogg/builderforce-brain-ui';
import { PRICING_URL } from '../config';
import { t } from '../i18n/t';
import { rovrComposerLabels } from './labels/composerLabels';
import type { RovrChatOptions } from './useRovrChatOptions';

export interface RovrComposerProps {
  value: string;
  onChange(value: string): void;
  onSubmit(): void;
  running: boolean;
  onStop(): void;
  chatOptions: RovrChatOptions;
  onOpenSettings(): void;
  /** Under the box — the queued-turns receipt. */
  below?: ReactNode;
}

export function RovrComposer({ value, onChange, onSubmit, running, onStop, chatOptions, onOpenSettings, below }: RovrComposerProps) {
  const { options, memoryGap, request, projectId } = chatOptions;
  const labels = useMemo(() => rovrComposerLabels(memoryGap), [memoryGap]);
  const locale = useMemo(() => chrome.i18n.getUILanguage(), []);
  const account = useMemo(
    () =>
      request
        ? {
            request,
            projectId,
            locale,
            onUpgrade: () => void chrome.tabs.create({ url: PRICING_URL }),
          }
        : undefined,
    [request, projectId, locale],
  );

  return (
    <BrainComposer
      className="rovr-chat__composer"
      value={value}
      onChange={onChange}
      onSubmit={onSubmit}
      running={running}
      onStop={onStop}
      placeholder={t('composerPlaceholder')}
      ariaLabel={t('composerLabel')}
      options={options}
      {...(account ? { account, onAccountSettings: onOpenSettings } : {})}
      labels={labels}
      below={below}
    />
  );
}
