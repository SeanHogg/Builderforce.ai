/**
 * The ONE reading of the transcript's copy catalog into `<BrainTimeline>`'s label shape.
 *
 * Every host keeps the transcript's strings in its own catalog — the web app in
 * `brain.timeline` (next-intl), the VS Code webview in its `tl.*` l10n bundle, the Chrome
 * extension in the web catalog bundled per locale — and each used to hand-map ~50 keys
 * onto {@link BrainTimelineLabels}. Three copies of one table drift; this is the table.
 *
 * A host passes a LOOKUP over the canonical key paths (the `brain.timeline` names:
 * `thinking`, `live.starting`, `activityStarted`, `learnSkipReasonFrozen`, …) and gets
 * every label, each falling back to the package's English default when its catalog has
 * no string for it. Placeholders (`{duration}`, `{tool}`, `{agent}` …) are the renderer's
 * own tokens, so a catalog string is used exactly as written.
 *
 * Pure: no React, no i18n library. A host memoizes the result (the transcript is
 * `React.memo`'d on its label object).
 */
import { DEFAULT_TIMELINE_LABELS, type BrainTimelineLabels } from './BrainTimeline';
import { DEFAULT_LIVE_ACTIVITY_LABELS, type LiveActivityLabels } from './LiveActivity';

/** A string for a canonical key path, or undefined when the catalog has none. */
export type TimelineCatalogLookup = (path: string) => string | undefined;

/** A lookup over a nested catalog object (`messages.brain.timeline`). */
export function timelineCatalogLookup(namespace: unknown): TimelineCatalogLookup {
  return (path) => {
    let node: unknown = namespace;
    for (const part of path.split('.')) {
      if (!node || typeof node !== 'object') return undefined;
      node = (node as Record<string, unknown>)[part];
    }
    return typeof node === 'string' && node.length > 0 ? node : undefined;
  };
}

/** Every string field of `defaults`, read at `prefix + field`. */
function stringsFrom<T extends object>(defaults: T, lookup: TimelineCatalogLookup, prefix = ''): T {
  const out = { ...defaults } as Record<string, unknown>;
  for (const [key, fallback] of Object.entries(defaults)) {
    if (typeof fallback === 'string') out[key] = lookup(`${prefix}${key}`) ?? fallback;
  }
  return out as T;
}

/** The animated in-flight row's copy (`live.*`). */
export function liveActivityLabelsFrom(lookup: TimelineCatalogLookup, overrides?: Partial<LiveActivityLabels>): LiveActivityLabels {
  return { ...stringsFrom(DEFAULT_LIVE_ACTIVITY_LABELS, lookup, 'live.'), ...overrides };
}

/** Run-milestone / agent-dispatch activity templates (`activity*`). */
export function chatActivityLabelsFrom(lookup: TimelineCatalogLookup): BrainTimelineLabels['activity'] {
  const d = DEFAULT_TIMELINE_LABELS.activity;
  return {
    milestoneStarted: lookup('activityStarted') ?? d.milestoneStarted,
    milestoneCompleted: lookup('activityCompleted') ?? d.milestoneCompleted,
    milestoneCompletedWithLane: lookup('activityCompletedWithLane') ?? d.milestoneCompletedWithLane,
    milestoneFailed: lookup('activityFailed') ?? d.milestoneFailed,
    milestonePaused: lookup('activityPaused') ?? d.milestonePaused,
    milestonePausedWithQuestion: lookup('activityPausedWithQuestion') ?? d.milestonePausedWithQuestion,
    milestoneResumed: lookup('activityResumed') ?? d.milestoneResumed,
    milestoneCancelled: lookup('activityCancelled') ?? d.milestoneCancelled,
    agentDispatched: lookup('activityDispatched') ?? d.agentDispatched,
  };
}

/** The whole transcript's copy. `overrides` is for copy a surface words on purpose. */
export function timelineLabelsFrom(lookup: TimelineCatalogLookup, overrides?: Partial<BrainTimelineLabels>): BrainTimelineLabels {
  const d = DEFAULT_TIMELINE_LABELS;
  return {
    ...stringsFrom(d, lookup),
    live: liveActivityLabelsFrom(lookup),
    learnSkipReason: {
      'not-attached': lookup('learnSkipReasonNotAttached') ?? d.learnSkipReason['not-attached'],
      'not-seeded': lookup('learnSkipReasonNotSeeded') ?? d.learnSkipReason['not-seeded'],
      frozen: lookup('learnSkipReasonFrozen') ?? d.learnSkipReason.frozen,
    },
    activity: chatActivityLabelsFrom(lookup),
    ...overrides,
  };
}
