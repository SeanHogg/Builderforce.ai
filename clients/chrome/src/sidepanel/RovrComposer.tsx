/**
 * Rovr's prompt area — THE shared `BrainComposer` (the box, `+`, the `/` Work panel with
 * Mode, Effort, Model and Status) the web and the editor mount, bound to the side panel:
 * its options are the chat's device record (`useRovrChatOptions`), the Status tab reads
 * through the panel's API client when signed in, and an upgrade opens the web app's
 * pricing page in a tab. Its tool row carries WHERE Rovr acts (`SiteChip`).
 */
import { useMemo, type ReactNode } from 'react';
import { BrainComposer, useComposerMenuRequest } from '@seanhogg/builderforce-brain-ui';
import { PRICING_URL } from '../config';
import { t } from '../i18n/t';
import { useInferenceModeOption } from './hooks';
import { rovrComposerLabels } from './labels/composerLabels';
import { ROVR_STARTERS } from './rovrStarters';
import { SiteChip } from './SiteChip';
import type { RovrChatOptions } from './useRovrChatOptions';

export interface RovrComposerProps {
  /** This composer's id — the key the chat's error banner opens ITS `/` menu with
   *  ("Pick a model"). */
  composerId: string;
  value: string;
  onChange(value: string): void;
  onSubmit(): void;
  running: boolean;
  onStop(): void;
  chatOptions: RovrChatOptions;
  onOpenSettings(): void;
  /** Above the text — the held turns (the shared queued chips). */
  above?: ReactNode;
  /** The fixed next-step chips — offered once a chat has begun (the empty state shows
   *  the same starters as tiles, so they are not offered twice). */
  showSuggestions: boolean;
}

export function RovrComposer({ composerId, value, onChange, onSubmit, running, onStop, chatOptions, onOpenSettings, above, showSuggestions }: RovrComposerProps) {
  const { options, memoryGap, request, projectId } = chatOptions;
  const labels = useMemo(() => rovrComposerLabels(memoryGap), [memoryGap]);
  // Where models run — the `/` menu's Run models control and the first-run question.
  // Nothing until the policy's first read: never the refused placeholder shown as a choice.
  const inferenceMode = useInferenceModeOption();
  // "Pick a model" (the banner beside this composer) opens this menu on its Model tab.
  const openMenu = useComposerMenuRequest(composerId);
  const composerOptions = useMemo(
    () => ({ ...options, ...(inferenceMode ? { inferenceMode } : {}), ...(openMenu ? { openMenu } : {}) }),
    [options, inferenceMode, openMenu],
  );
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
      options={composerOptions}
      {...(account ? { account, onAccountSettings: onOpenSettings } : {})}
      labels={labels}
      above={above}
      // WHERE the turn acts — the site of the tab Rovr is working in.
      context={<SiteChip />}
      // Fixed next steps — a chip seeds the box; the person edits and sends it.
      {...(showSuggestions
        ? {
            suggestions: {
              label: t('suggestionsLabel'),
              items: ROVR_STARTERS.map((s) => ({ id: s.id, label: t(s.label), onSelect: () => onChange(t(s.prompt)) })),
            },
          }
        : {})}
    />
  );
}
