/**
 * The project panel's TAB VOCABULARY, and where a prescriptive fix lands.
 *
 * Data, not branching: a new tab is an entry in `PROJECT_PANEL_TABS`, and a new
 * inspection recommendation is an entry in `RECOMMENDATION_TARGET`. Neither is a
 * new `case` inside the panel — which is how the panel came to own nine unrelated
 * things in the first place.
 *
 * It lives beside the panel rather than inside it because four other surfaces —
 * the project card, the table, the inspection report, the projects page — need to
 * NAME a tab in order to open the panel on it, and importing a component to get a
 * string union is how a component becomes the file everyone has to edit.
 */

export type ProjectPanelTab =
  | 'analytics'
  | 'details'
  | 'integrations'
  | 'taskMgmt'
  | 'prds'
  | 'diagnostics'
  | 'capabilities'
  | 'brainChat'
  | 'workspace';

/** Tab id → i18n key; labels resolved through `projectDetails.tabs.*` at render. */
export const PROJECT_PANEL_TABS: ReadonlyArray<{ id: ProjectPanelTab; key: string }> = [
  { id: 'analytics', key: 'tabs.analytics' },
  { id: 'details', key: 'tabs.details' },
  { id: 'integrations', key: 'tabs.integrations' },
  { id: 'taskMgmt', key: 'tabs.taskMgmt' },
  { id: 'prds', key: 'tabs.prds' },
  { id: 'diagnostics', key: 'tabs.diagnostics' },
  { id: 'capabilities', key: 'tabs.capabilities' },
  { id: 'brainChat', key: 'tabs.brainChat' },
  { id: 'workspace', key: 'tabs.workspace' },
];

/** DOM ids of details-tab fields a "Fix" can scroll to / focus. */
export type DetailsFocusTarget = 'edit-description' | 'edit-due-date' | 'project-initiative-section';

export type RecommendationTarget = {
  tab: ProjectPanelTab;
  focus?: DetailsFocusTarget;
  edit?: boolean;
  specKind?: string;
};

/**
 * Where each prescriptive "what to target" fix is actually made. Most fixes live
 * on another tab; the details-resident ones (vision, goals, deadline) also name
 * the field to surface so the Fix button does something visible instead of
 * re-selecting the tab the report already lives on. `edit` opens the overview
 * edit form first (the field only exists in edit mode). `workflows` is omitted —
 * the report renders that one as a link to the top-level /workflows route.
 *
 * `specKind` is the PRDs-tab equivalent of `focus`: the architecture fix used to
 * drop the user on a list of every PRD the project has and leave them to find
 * the one the report was talking about. Naming the kind opens that document.
 */
export const RECOMMENDATION_TARGET: Record<string, RecommendationTarget> = {
  vision: { tab: 'details', focus: 'edit-description', edit: true },
  goals: { tab: 'details', focus: 'project-initiative-section' },
  deadline: { tab: 'details', focus: 'edit-due-date', edit: true },
  schedule: { tab: 'taskMgmt' },
  tasks: { tab: 'taskMgmt' },
  decompose: { tab: 'taskMgmt' },
  overdue: { tab: 'taskMgmt' },
  blocked: { tab: 'taskMgmt' },
  stalled: { tab: 'taskMgmt' },
  owner: { tab: 'capabilities' },
  architecture: { tab: 'prds', specKind: 'architecture' },
};
