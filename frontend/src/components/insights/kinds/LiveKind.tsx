/**
 * The `live` panel kind: the whole site's live view. The level id, when set,
 * is a route to narrow to (the Page stage's "open live" link). A visitor tile
 * opens the recording in follow mode.
 */

import { LiveView } from '@/components/replay/LiveView';
import type { InsightPanelKindProps } from '../panelKinds';

export function LiveKind({ siteId, id, push }: InsightPanelKindProps) {
  return (
    <LiveView
      siteId={siteId}
      route={id || null}
      onOpenRecording={(recordingId) => push({ kind: 'recording', id: recordingId, tab: 'replay', follow: true })}
    />
  );
}
