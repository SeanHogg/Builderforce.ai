/**
 * Board provider catalog — the SINGLE source of truth for which external
 * work/incident systems can be connected as a synced board.
 *
 * Every consumer derives from this list instead of re-declaring its own:
 *   - boardConnectionRoutes  → valid `provider` values + the GET /providers feed
 *   - providers.ts           → the adapter registry must cover every id here
 *   - webhookIngest.ts       → `supportsWebhook` gates inbound webhook normalize
 *
 * Categories mirror the product's integration story:
 *   pm       — project/work management (Jira, Linear, Monday, Asana, ClickUp)
 *   itsm     — IT service management (Freshservice, ServiceNow)
 *   incident — monitoring/on-call that creates work (Sentry, PagerDuty)
 *   scm      — source-control issue trackers (GitHub)
 */

export type BoardProviderCategory = 'pm' | 'itsm' | 'incident' | 'scm';

export interface BoardProviderMeta {
  /** Stable id — also the value stored in board_connections.provider + tasks.source. */
  id: string;
  /** Human label for pickers. */
  label: string;
  category: BoardProviderCategory;
  /** Whether the external board id is needed, and a hint for the input. */
  externalBoardId: 'required' | 'optional';
  externalBoardIdHint: string;
  /** True when an inbound webhook payload can be normalized (webhookIngest). */
  supportsWebhook: boolean;
}

export const BOARD_PROVIDERS: readonly BoardProviderMeta[] = [
  { id: 'github',       label: 'GitHub Issues', category: 'scm',      externalBoardId: 'required', externalBoardIdHint: 'Repository — owner/repo (e.g. octocat/hello-world)', supportsWebhook: true },
  { id: 'jira',         label: 'Jira',          category: 'pm',       externalBoardId: 'optional', externalBoardIdHint: 'Project key (e.g. ENG) — blank syncs all', supportsWebhook: true },
  { id: 'linear',       label: 'Linear',        category: 'pm',       externalBoardId: 'optional', externalBoardIdHint: 'Team ID (optional) — blank syncs all teams', supportsWebhook: true },
  { id: 'monday',       label: 'monday.com',    category: 'pm',       externalBoardId: 'required', externalBoardIdHint: 'Board ID (numeric)', supportsWebhook: true },
  { id: 'asana',        label: 'Asana',         category: 'pm',       externalBoardId: 'required', externalBoardIdHint: 'Project GID', supportsWebhook: false },
  { id: 'clickup',      label: 'ClickUp',       category: 'pm',       externalBoardId: 'required', externalBoardIdHint: 'List ID', supportsWebhook: false },
  { id: 'freshservice', label: 'Freshservice',  category: 'itsm',     externalBoardId: 'optional', externalBoardIdHint: 'Workspace ID (optional) — blank syncs all tickets', supportsWebhook: false },
  { id: 'servicenow',   label: 'ServiceNow',    category: 'itsm',     externalBoardId: 'optional', externalBoardIdHint: 'Table name (default: incident)', supportsWebhook: false },
  { id: 'sentry',       label: 'Sentry',        category: 'incident', externalBoardId: 'required', externalBoardIdHint: 'organization-slug/project-slug', supportsWebhook: true },
  { id: 'pagerduty',    label: 'PagerDuty',     category: 'incident', externalBoardId: 'optional', externalBoardIdHint: 'Service ID (optional) — blank syncs all services', supportsWebhook: true },
] as const;

/** Valid `provider` values for a board connection. */
export const BOARD_PROVIDER_IDS: readonly string[] = BOARD_PROVIDERS.map((p) => p.id);

/** Providers whose inbound webhook payloads webhookIngest can normalize. */
export const WEBHOOK_BOARD_PROVIDER_IDS: readonly string[] = BOARD_PROVIDERS.filter((p) => p.supportsWebhook).map(
  (p) => p.id,
);

export function getBoardProviderMeta(id: string): BoardProviderMeta | undefined {
  return BOARD_PROVIDERS.find((p) => p.id === id);
}
