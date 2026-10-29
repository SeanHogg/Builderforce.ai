/**
 * INSIGHT_PANEL_KINDS — the ONE registry of what the Insights panel can show
 * (PRD 33 D16, §4.1).
 *
 * A level of the panel is `{ kind, id, tab? }`; the kind's row names its label
 * and its tabs, and each tab is a component taking `InsightPanelKindProps`.
 * A later slice adds a kind by adding a row (route, proof) or a tab by adding a
 * tab to a row — never a branch in the panel,
 * never a second overlay. A kind with one view has one tab, id `main`.
 *
 * `labelKey`s resolve under the `insights` namespace.
 */

import type { ComponentType } from 'react';
import { replayApi } from '@/lib/replayApi';
import { VISITOR_PANEL_TABS, type VisitorPanelTabId, type VisitorTabRequirement } from '@/components/visitors/visitorPanelTabs';
import { SitesKind } from '@/components/insights/kinds/SitesKind';
import { PlanKind } from '@/components/insights/kinds/PlanKind';
import { IssueOverviewTab, IssueRecordingsTab } from './kinds/IssueKind';
import { IssuesKind } from './kinds/IssuesKind';
import { LiveKind } from './kinds/LiveKind';
import { RecordingJourneyTab, RecordingLeadTab, RecordingReplayTab } from './kinds/RecordingKind';
import { RouteHeatTab, RouteReviewTab } from './kinds/RouteKind';
import { MetricKind } from './kinds/MetricKind';
import { FunnelEventsTab, FunnelFlowTab, FunnelStepsTab } from './kinds/FunnelKind';
import { FunnelEditKind } from './kinds/FunnelEditKind';
import { FixChangeTab, FixMeasureTab, IssueFixTab, IssueHistoryTab } from './kinds/FixKind';
import { FixesKind } from './kinds/FixesKind';
import { FixPromptTab } from './kinds/FixPromptTab';
import { PagesKind } from './kinds/PagesKind';
import { ProofKind } from './kinds/ProofKind';
import { ReleaseKind } from './kinds/ReleaseKind';

export type InsightPanelKind =
  | 'recording' | 'issue' | 'issues' | 'fix' | 'fixes' | 'pages' | 'route' | 'metric'
  | 'funnel' | 'funnel_edit' | 'live' | 'proof' | 'release' | 'sites' | 'plan';

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

/** A fact a tab needs before it is offered (tabs are filtered by data, not branches): the visitor panel's one vocabulary. */
export type InsightTabRequirement = VisitorTabRequirement;

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

/** This surface's body for each row of the ONE visitor-panel registry. */
const RECORDING_VISITOR_BODIES: Record<VisitorPanelTabId, ComponentType<InsightPanelKindProps>> = {
  journey: RecordingJourneyTab,
  lead: RecordingLeadTab,
};

/** The recording kind: Replay in front, then the visitor panel's tabs (`VISITOR_PANEL_TABS`: ids, order and `requires`). */
const RECORDING_TABS: ReadonlyArray<InsightPanelTab> = [
  { id: 'replay', labelKey: 'kinds.tabs.replay', Component: RecordingReplayTab },
  ...VISITOR_PANEL_TABS.map((row): InsightPanelTab => ({
    id: row.id,
    labelKey: `kinds.tabs.${row.id}`,
    Component: RECORDING_VISITOR_BODIES[row.id],
    ...(row.requires ? { requires: row.requires } : {}),
  })),
];

export const INSIGHT_PANEL_KINDS: ReadonlyArray<InsightPanelKindDef> = [
  { kind: 'recording', labelKey: 'kinds.recording', tabs: RECORDING_TABS },
  {
    kind: 'issue',
    labelKey: 'kinds.issue',
    tabs: [
      { id: 'overview', labelKey: 'kinds.tabs.overview', Component: IssueOverviewTab },
      { id: 'recordings', labelKey: 'kinds.tabs.recordings', Component: IssueRecordingsTab },
      // S4e: the issue's prescription (by `prescriptionId`) and its status history.
      { id: 'fix', labelKey: 'fix.issueTabs.fix', Component: IssueFixTab },
      { id: 'history', labelKey: 'fix.issueTabs.history', Component: IssueHistoryTab },
    ],
  },
  { kind: 'issues', labelKey: 'kinds.issues', tabs: [{ id: 'main', labelKey: 'kinds.issues', Component: IssuesKind }] },
  {
    // One prescription (S4e); its improvement prompt (S4f).
    kind: 'fix',
    labelKey: 'kinds.fix',
    tabs: [
      { id: 'change', labelKey: 'fix.tabs.change', Component: FixChangeTab },
      { id: 'prompt', labelKey: 'fix.tabs.prompt', Component: FixPromptTab },
      { id: 'measure', labelKey: 'fix.tabs.measure', Component: FixMeasureTab },
    ],
  },
  // Every fix, from Do next's "View all" (S4e). The level id is the area to open on.
  { kind: 'fixes', labelKey: 'fixes.kind', tabs: [{ id: 'main', labelKey: 'fixes.kind', Component: FixesKind }] },
  // The key pages ranked by opportunity, from Do next's header (S4f). A row opens `route:<path>:review`.
  { kind: 'pages', labelKey: 'pages.kind', tabs: [{ id: 'main', labelKey: 'pages.kind', Component: PagesKind }] },
  // One release's improvement ledger, from the score-by-release strip (S4e).
  { kind: 'release', labelKey: 'kinds.release', tabs: [{ id: 'main', labelKey: 'kinds.release', Component: ReleaseKind }] },
  {
    // One page: its heat, and its page review (S4f).
    kind: 'route',
    labelKey: 'route.kind',
    tabs: [
      { id: 'heat', labelKey: 'route.tabs.heat', Component: RouteHeatTab },
      { id: 'review', labelKey: 'route.tabs.review', Component: RouteReviewTab },
    ],
  },
  // The Overview dashboard, opened from a KPI tile (S4c).
  { kind: 'metric', labelKey: 'kinds.metric', tabs: [{ id: 'main', labelKey: 'kinds.metric', Component: MetricKind }] },
  {
    // Funnels, smart events and the flow (S4c). The spec's "Clusters" tab is Events here.
    kind: 'funnel',
    labelKey: 'kinds.funnel',
    tabs: [
      { id: 'steps', labelKey: 'funnel.tabs.steps', Component: FunnelStepsTab },
      { id: 'events', labelKey: 'funnel.tabs.events', Component: FunnelEventsTab },
      { id: 'flow', labelKey: 'funnel.tabs.flow', Component: FunnelFlowTab },
    ],
  },
  // Creating / editing a funnel: a level over the funnel (D16 — never a second overlay).
  { kind: 'funnel_edit', labelKey: 'kinds.funnelEdit', tabs: [{ id: 'main', labelKey: 'kinds.funnelEdit', Component: FunnelEditKind }] },
  { kind: 'live', labelKey: 'kinds.live', tabs: [{ id: 'main', labelKey: 'kinds.live', Component: LiveKind }] },
  // The live proof's measured state, from the header's proof chip (S4d). The level id is the realization id.
  { kind: 'proof', labelKey: 'kinds.proof', tabs: [{ id: 'main', labelKey: 'kinds.proof', Component: ProofKind }] },
  { kind: 'sites', labelKey: 'kinds.sites', tabs: [{ id: 'main', labelKey: 'kinds.sites', Component: SitesKind }] },
  { kind: 'plan', labelKey: 'kinds.plan', tabs: [{ id: 'main', labelKey: 'kinds.plan', Component: PlanKind }] },
];

export function panelKindDef(kind: string): InsightPanelKindDef | undefined {
  return INSIGHT_PANEL_KINDS.find((row) => row.kind === kind);
}

/** How the recording surface establishes each requirement for a level's id (the admin surface states its facts directly). */
export const TAB_REQUIREMENTS: Readonly<Record<InsightTabRequirement, (siteId: string, id: string) => Promise<boolean>>> = {
  identified: async (siteId, id) => (await replayApi.getRecording(siteId, id)).identifiedId != null,
};
