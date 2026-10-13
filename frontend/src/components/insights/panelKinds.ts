/**
 * INSIGHT_PANEL_KINDS — the ONE registry of what the Insights panel can show
 * (PRD 33 D16, §4.1).
 *
 * A level of the panel is `{ kind, id, tab? }`; the kind's row names its label
 * and its tabs, and each tab is a component taking `InsightPanelKindProps`.
 * A later slice adds a kind by adding a row (fix, route, metric, funnel, proof,
 * release) or a tab by adding a tab to a row — never a branch in the panel,
 * never a second overlay. A kind with one view has one tab, id `main`.
 *
 * `labelKey`s resolve under the `insights` namespace.
 */

import type { ComponentType } from 'react';
import { replayApi } from '@/lib/replayApi';
import { SitesKind } from '@/components/insights/kinds/SitesKind';
import { PlanKind } from '@/components/insights/kinds/PlanKind';
import { IssueOverviewTab, IssueRecordingsTab } from './kinds/IssueKind';
import { IssuesKind } from './kinds/IssuesKind';
import { LiveKind } from './kinds/LiveKind';
import { RecordingJourneyTab, RecordingLeadTab, RecordingReplayTab } from './kinds/RecordingKind';

export type InsightPanelKind =
  | 'recording' | 'issue' | 'issues' | 'fix' | 'route' | 'metric'
  | 'funnel' | 'live' | 'proof' | 'release' | 'sites' | 'plan';

export type InsightPanelLevel = {
  kind: InsightPanelKind;
  id: string;
  tab?: string;
  /** Seconds into a recording (`&t=`). */
  t?: number;
  /** Live follow for a recording (`&follow=1`). */
  follow?: boolean;
};

export type InsightPanelKindProps = {
  siteId: string;
  id: string;
  tab?: string;
  t?: number;
  follow?: boolean;
  push: (level: InsightPanelLevel) => void;
};

/** A fact a tab needs before it is offered (tabs are filtered by data, not branches). */
export type InsightTabRequirement = 'identified';

export interface InsightPanelTab {
  id: string;
  labelKey: string;
  Component: ComponentType<InsightPanelKindProps>;
  requires?: InsightTabRequirement;
}

export interface InsightPanelKindDef {
  kind: InsightPanelKind;
  labelKey: string;
  tabs: ReadonlyArray<InsightPanelTab>;
}

export const INSIGHT_PANEL_KINDS: ReadonlyArray<InsightPanelKindDef> = [
  {
    kind: 'recording',
    labelKey: 'kinds.recording',
    tabs: [
      { id: 'replay', labelKey: 'kinds.tabs.replay', Component: RecordingReplayTab },
      { id: 'journey', labelKey: 'kinds.tabs.journey', Component: RecordingJourneyTab },
      { id: 'lead', labelKey: 'kinds.tabs.lead', Component: RecordingLeadTab, requires: 'identified' },
    ],
  },
  {
    kind: 'issue',
    labelKey: 'kinds.issue',
    tabs: [
      { id: 'overview', labelKey: 'kinds.tabs.overview', Component: IssueOverviewTab },
      { id: 'recordings', labelKey: 'kinds.tabs.recordings', Component: IssueRecordingsTab },
    ],
  },
  { kind: 'issues', labelKey: 'kinds.issues', tabs: [{ id: 'main', labelKey: 'kinds.issues', Component: IssuesKind }] },
  { kind: 'live', labelKey: 'kinds.live', tabs: [{ id: 'main', labelKey: 'kinds.live', Component: LiveKind }] },
  { kind: 'sites', labelKey: 'kinds.sites', tabs: [{ id: 'main', labelKey: 'kinds.sites', Component: SitesKind }] },
  { kind: 'plan', labelKey: 'kinds.plan', tabs: [{ id: 'main', labelKey: 'kinds.plan', Component: PlanKind }] },
];

export function panelKindDef(kind: string): InsightPanelKindDef | undefined {
  return INSIGHT_PANEL_KINDS.find((row) => row.kind === kind);
}

/** How each requirement is checked for a level's id. */
export const TAB_REQUIREMENTS: Readonly<Record<InsightTabRequirement, (siteId: string, id: string) => Promise<boolean>>> = {
  identified: async (siteId, id) => (await replayApi.getRecording(siteId, id)).identifiedId != null,
};
