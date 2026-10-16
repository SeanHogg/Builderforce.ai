import { useMemo } from 'react';
import { useMessages } from 'next-intl';
import { timelineCatalogLookup, timelineLabelsFrom, type BrainTimelineLabels, type TimelineCatalogLookup } from '@seanhogg/builderforce-brain-ui';

/**
 * THE web-side copy for `<BrainTimeline>` — every string the shared transcript renders,
 * read from the `brain.timeline` catalog through brain-ui's ONE catalog → label table
 * (`timelineLabelsFrom`), the same table the VS Code webview and the Chrome extension
 * read their copy through. No host maps the ~50 keys by hand any more.
 *
 * Two surfaces mount that transcript (the Brain panel and the Creation Canvas dock); both
 * come through here. The memo is load-bearing: `<BrainTimeline>` is `React.memo`'d on this
 * object, and a fresh one per render re-parses the whole transcript's markdown on every
 * keystroke.
 *
 * The catalog strings are read RAW: their `{duration}` / `{count}` / `{agent}` … are the
 * renderer's own tokens, substituted by the transcript, never by next-intl.
 *
 * `overrides` is for copy a surface deliberately words differently — the canvas dock
 * calls the assistant by the board's name for it and drives its own phase line. Pass a
 * MEMOIZED object; an inline literal defeats the memo it is threaded through.
 *
 * No `'use client'` of its own: it is only ever imported by client components, so it is
 * client-bundled by them.
 */
export function useBrainTimelineLabels(overrides?: Partial<BrainTimelineLabels>): BrainTimelineLabels {
  const lookup = useTimelineCatalog();
  return useMemo(() => timelineLabelsFrom(lookup, overrides), [lookup, overrides]);
}

/** The `brain.timeline` catalog as a lookup, stable while the messages are. */
export function useTimelineCatalog(): TimelineCatalogLookup {
  const messages = useMessages() as { brain?: { timeline?: unknown } } | undefined;
  const namespace = messages?.brain?.timeline;
  return useMemo(() => timelineCatalogLookup(namespace), [namespace]);
}
