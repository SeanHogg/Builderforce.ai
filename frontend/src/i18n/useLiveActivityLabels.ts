import { useMemo } from 'react';
import { liveActivityLabelsFrom, type LiveActivityLabels } from '@seanhogg/builderforce-brain-ui';
import { useTimelineCatalog } from './useBrainTimelineLabels';

/**
 * THE web-side source of the in-flight activity copy — the animated row that says
 * which tool is running, on what, and for how long — read from `brain.timeline.live`
 * through brain-ui's shared table (`liveActivityLabelsFrom`), the same reading the
 * transcript's own labels use, so a run narrates itself identically in the panel and
 * on the board. Memoized because `<BrainTimeline>` and `<LiveActivity>` are both
 * `React.memo`'d on their label object.
 */
export function useLiveActivityLabels(): LiveActivityLabels {
  const lookup = useTimelineCatalog();
  return useMemo(() => liveActivityLabelsFrom(lookup), [lookup]);
}
