import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { DEFAULT_TIMELINE_LABELS, type BrainTimelineLabels } from '@seanhogg/builderforce-brain-ui';
import { useChatActivityLabels } from './useChatActivityLabels';
import { useLiveActivityLabels } from './useLiveActivityLabels';

/**
 * THE web-side copy for `<BrainTimeline>` — every string the shared transcript renders,
 * read once from the `brain.timeline` catalog.
 *
 * Two surfaces mount that transcript (the Brain panel and the Creation Canvas dock) and
 * each used to assemble its own bundle inline. The bundles drifted exactly the way two
 * copies of a list always do: the dock named the messages and the phases and stopped
 * there, so the tool steps it renders — Input, Output, the change preview — fell back to
 * the package's English defaults on a board someone was reading in French, and every
 * Evermind memory step on the canvas was untranslated too.
 *
 * One hook, one namespace, memoized: the memo is load-bearing because `<BrainTimeline>`
 * is `React.memo`'d on this object, and a fresh one per render re-parses the whole
 * transcript's markdown on every keystroke.
 *
 * `overrides` is for copy a surface deliberately words differently — the canvas dock
 * calls the assistant by the board's name for it and drives its own phase line. Pass a
 * MEMOIZED object; an inline literal defeats the memo it is threaded through.
 *
 * No `'use client'` of its own: it is only ever imported by client components, so it is
 * client-bundled by them.
 */
export function useBrainTimelineLabels(overrides?: Partial<BrainTimelineLabels>): BrainTimelineLabels {
  const t = useTranslations('brain.timeline');
  const activity = useChatActivityLabels();
  const live = useLiveActivityLabels();
  return useMemo(() => ({
    ...DEFAULT_TIMELINE_LABELS,
    thinking: t('thinking'),
    // The ANIMATED in-flight row — the only thing on screen while a long tool call
    // runs. From the SHARED hook, so no two surfaces word the same running step
    // differently.
    live,
    // Every templated string is handed back its own literal token: the RENDERER
    // substitutes `{duration}` / `{count}` / `{version}` / `{code}`, not next-intl,
    // and a message whose ICU argument is never supplied resolves to its key path
    // instead of its text.
    thoughtFor: t('thoughtFor', { duration: '{duration}' }),
    thought: t('thought'),
    replyFromThought: t('replyFromThought'),
    you: t('you'),
    assistant: t('assistant'),
    input: t('input'),
    output: t('output'),
    // Shell steps: the terminal panel's exit chip and its "printed nothing" note.
    exitCode: t('exitCode', { code: '{code}' }),
    noOutput: t('noOutput'),
    error: t('error'),
    loading: t('loading'),
    empty: t('empty'),
    copy: t('copy'),
    copied: t('copied'),
    replay: t('replay'),
    rateUp: t('rateUp'),
    rateDown: t('rateDown'),
    apply: t('apply'),
    createFile: t('createFile'),
    preview: t('preview'),
    askSubmit: t('askSubmit'),
    askAnswered: t('askAnswered'),
    accountOwn: t('accountOwn'),
    accountShared: t('accountShared'),
    accountByoUnused: t('accountByoUnused'),
    ranOnEvermind: t('ranOnEvermind'),
    recallTitle: t('recallTitle', { count: '{count}', version: '{version}' }),
    recallHint: t('recallHint'),
    learnTitle: t('learnTitle', { version: '{version}' }),
    learnHint: t('learnHint'),
    learnSkippedTitle: t('learnSkippedTitle', { reason: '{reason}' }),
    learnSkippedHint: t('learnSkippedHint'),
    learnSkipReason: {
      'not-attached': t('learnSkipReasonNotAttached'),
      'not-seeded': t('learnSkipReasonNotSeeded'),
      frozen: t('learnSkipReasonFrozen'),
    },
    learnTargetContributed: t('learnTargetContributed', { name: '{name}', projectId: '{projectId}', version: '{version}' }),
    learnTargetSkipped: t('learnTargetSkipped', { name: '{name}', projectId: '{projectId}', reason: '{reason}' }),
    reconcileTitle: t('reconcileTitle', { count: '{count}', version: '{version}' }),
    reconcileHint: t('reconcileHint'),
    // Run milestones / agent dispatch render as system ACTIVITY lines composed from the
    // message's structured metadata — see useChatActivityLabels for why these are
    // templates rather than sentences.
    activity,
    ...overrides,
  }), [t, activity, live, overrides]);
}
