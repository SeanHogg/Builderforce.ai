import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import type { LiveActivityLabels } from '@seanhogg/builderforce-brain-ui';

/**
 * THE web-side source of the in-flight activity copy — the animated row that says
 * which tool is running, on what, and for how long.
 *
 * Same reasoning as {@link useChatActivityLabels}, and the same namespace: every
 * surface that mounts `<BrainTimeline>` (the Brain panel, the Creation Canvas dock)
 * must hand it one identical bundle, or the same run narrates itself one way in the
 * panel and another on the board. Memoized because `<BrainTimeline>` and
 * `<LiveActivity>` are both `React.memo`'d on their label object, and a fresh one
 * per render would defeat the memo on the hottest path in the app (a row that
 * repaints once a second inside a transcript that repaints on every token).
 *
 * `{tool}` / `{target}` / `{step}` / `{elapsed}` are ICU arguments to next-intl but
 * NOT to us — `<LiveActivity>` substitutes them itself — so each is handed back its
 * own literal token, the same trick the activity templates already use.
 *
 * `overrides` lets a surface that derives its own phase line (the canvas dock reads
 * one off the run trace) keep it while still gaining the animation, instead of
 * having to choose between the two.
 */
export function useLiveActivityLabels(overrides?: Partial<LiveActivityLabels>): LiveActivityLabels {
  const t = useTranslations('brain.timeline.live');
  return useMemo(() => ({
    starting: t('starting'),
    thinking: t('thinking'),
    writing: t('writing'),
    tool: t('tool', { tool: '{tool}' }),
    awaiting: t('awaiting', { tool: '{tool}' }),
    finishing: t('finishing'),
    on: t('on', { target: '{target}' }),
    step: t('step', { step: '{step}' }),
    slow: t('slow', { elapsed: '{elapsed}' }),
    ariaLabel: t('ariaLabel'),
    ...overrides,
  }), [t, overrides]);
}
