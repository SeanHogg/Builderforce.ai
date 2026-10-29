/**
 * VISITOR_PANEL_TABS — the ONE tab registry of the visitor panel (PRD 33 §4.1, §6
 * "one visitor panel"), with the ONE `requires` mechanism.
 *
 * A visitor has two readings, Journey and Lead. Both surfaces draw them from these
 * rows — Admin ▸ Growth ▸ Visitors (`VisitorPanel`) and the Insights `recording`
 * kind (`panelKinds.ts`, which puts its Replay tab in front) — and each supplies
 * only what differs: the body of a tab and the facts it can state. Pure data, so
 * either surface can import it without importing the other's components.
 *
 * `requires` names a fact a tab needs; `offeredTabs` is the one predicate that
 * decides (a tab whose requirement is not known to hold is not offered).
 */

export type VisitorPanelTabId = 'journey' | 'lead';

/** A fact about the visitor a tab needs before it is offered. */
export type VisitorTabRequirement = 'identified';

/** The facts a surface has established; an absent or false fact leaves its tabs unoffered. */
export type VisitorTabFacts = Readonly<Partial<Record<VisitorTabRequirement, boolean>>>;

export interface VisitorPanelTabDef {
  id: VisitorPanelTabId;
  /** Full key (several admin namespaces share this panel). */
  labelKey: string;
  /** Full key of the admin panel's title while this tab is open. */
  titleKey: string;
  requires?: VisitorTabRequirement;
}

export const VISITOR_PANEL_TABS: ReadonlyArray<VisitorPanelTabDef> = [
  { id: 'journey', labelKey: 'admin.insights.tabJourney', titleKey: 'admin.visitorFlow.journeyTitle' },
  { id: 'lead', labelKey: 'admin.insights.tabLead', titleKey: 'admin.sessions.drawerTitle', requires: 'identified' },
];

/** The tabs whose `requires` the surface's facts establish — the one offering rule. */
export function offeredTabs<T extends { requires?: VisitorTabRequirement }>(tabs: readonly T[], facts: VisitorTabFacts): T[] {
  return tabs.filter((tab) => !tab.requires || facts[tab.requires] === true);
}
