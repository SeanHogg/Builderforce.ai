import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { ChatActivityLabels } from '@seanhogg/builderforce-brain-embedded';

/**
 * THE web-side source of the run-activity line templates.
 *
 * Every surface that mounts `<BrainTimeline>` (the Brain panel, the Creation Canvas dock)
 * has to hand it the same nine templates, and building them inline at each mount is
 * exactly the duplication that lets two transcripts of the same conversation word a
 * milestone differently. One hook, one namespace, memoized — the memo matters because
 * `<BrainTimeline>` is `React.memo`'d on its label object and a fresh one per render
 * would re-parse the whole transcript on every keystroke.
 *
 * The templates carry `{agent}` / `{kind}` / `{ref}` / `{lane}` / `{question}`
 * placeholders and are filled by `chatActivityText` — so word order belongs to the
 * translator, not to the server that recorded the event in English.
 *
 * No `'use client'` of its own: it is only ever imported by client components
 * (`BrainPanel`, `BrainDock`), so it is client-bundled by them — adding the directive
 * would only push the architecture ratchet's client-file count up for nothing.
 */
export function useChatActivityLabels(): ChatActivityLabels {
  const t = useTranslations('brain.timeline');
  return useMemo(() => {
    // next-intl parses `{x}` as an ICU argument, so each placeholder is handed back its
    // own literal token — the same trick the canvas dock already uses for `{duration}`.
    // The renderer (`chatActivityText`) is what finally substitutes the real values.
    const base = { agent: '{agent}', kind: '{kind}', ref: '{ref}' };
    return {
      milestoneStarted: t('activityStarted', base),
      milestoneCompleted: t('activityCompleted', base),
      milestoneCompletedWithLane: t('activityCompletedWithLane', { ...base, lane: '{lane}' }),
      milestoneFailed: t('activityFailed', base),
      milestonePaused: t('activityPaused', base),
      milestonePausedWithQuestion: t('activityPausedWithQuestion', { ...base, question: '{question}' }),
      milestoneResumed: t('activityResumed', base),
      milestoneCancelled: t('activityCancelled', base),
      agentDispatched: t('activityDispatched', base),
    };
  }, [t]);
}
