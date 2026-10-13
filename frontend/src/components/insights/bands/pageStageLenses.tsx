/**
 * PAGE_STAGE_LENSES — what the Page stage can show for its route (PRD 33 §4.1:
 * Heat · Stuck · Fixes · Live). Live ships now; S4 adds `heat`, S4c `stuck`,
 * S4e `fixes`, each as a row here.
 */

import type { ComponentType } from 'react';
import { LiveView } from '@/components/replay/LiveView';
import { usePanel } from '../usePanel';

export interface PageStageLensProps {
  siteId: string;
  route: string;
}

export interface PageStageLens {
  id: string;
  /** Under `insights.lenses`. */
  labelKey: string;
  Component: ComponentType<PageStageLensProps>;
}

function LiveLens({ siteId, route }: PageStageLensProps) {
  const { push } = usePanel();
  return (
    <LiveView
      compact
      siteId={siteId}
      route={route}
      onOpenRecording={(recordingId) => push({ kind: 'recording', id: recordingId, tab: 'replay', follow: true })}
    />
  );
}

export const PAGE_STAGE_LENSES: ReadonlyArray<PageStageLens> = [
  { id: 'live', labelKey: 'live', Component: LiveLens },
];
