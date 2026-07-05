/**
 * Generic project-list model — the shared contract for every list-shaped project
 * page rendered natively in a bundled-React webview (Backlog, PRDs, and future
 * list views). One presentational <ProjectListView> renders any of them; each host
 * screen maps its API response into this model, so the transport/theme/empty-error
 * handling is written once (DRY) and the per-view code is just a fetch + a mapper.
 */

import type { TicketKind } from '../chatTickets/types';

export type ProjectListTone = 'default' | 'accent' | 'ok' | 'warn' | 'danger' | 'muted';

/** A work item to auto-link to the chat when the row's action opens one. */
export interface ProjectListTicketRef {
  kind: TicketKind;
  ref: string;
  title?: string;
}

export interface ProjectListBadge {
  label: string;
  tone?: ProjectListTone;
}

/** A row action, forwarded verbatim to the host (which owns the actual command). */
export interface ProjectListAction {
  kind: 'open-task' | 'brain' | 'open-360';
  label?: string;
  /** For `brain`: the seed prompt. */
  text?: string;
  /** For `open-task`: the task to open a working session for. */
  task?: { id: number; key?: string; title: string; taskType?: 'task' | 'epic' | 'gap' };
  /** The work item this row represents — the host auto-links it to the opened chat
   *  so the conversation is tied to (and has context on) the item that spawned it. */
  ticket?: ProjectListTicketRef;
}

export interface ProjectListItem {
  id: string | number;
  /** Short human key shown as a monospace chip (e.g. a task key or spec id). */
  key?: string;
  title: string;
  subtitle?: string;
  badges?: ProjectListBadge[];
  /** Clicking the row (and its primary button) raises this. */
  action?: ProjectListAction;
}

export interface ProjectListGroup {
  key: string;
  label: string;
  tone?: ProjectListTone;
  items: ProjectListItem[];
}

export interface ProjectListModel {
  groups: ProjectListGroup[];
  total: number;
}

/** UI strings — English defaults, overridable so the host can localize (the VS Code
 *  webview feeds its `vscode.l10n` bundle; the web app next-intl). */
export interface ProjectListLabels {
  refresh: string;
  connecting: string;
  loadError: string;
  empty: string;
  emptyHint: string;
  items: string;
}

export const DEFAULT_PROJECT_LIST_LABELS: ProjectListLabels = {
  refresh: 'Refresh',
  connecting: 'Loading…',
  loadError: "Couldn't load this page",
  empty: 'Nothing here yet',
  emptyHint: '',
  items: 'items',
};
