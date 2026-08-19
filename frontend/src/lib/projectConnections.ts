/**
 * Project connections — shared frontend types + fetcher for the connection
 * status strip on the projects widget.
 *
 * The API (`GET /api/projects/connections`) composes every project's connections
 * in ONE tenant-wide, cached read, so the card grid and the list view render
 * their status without an N+1 per-project fetch. Mirrors how the diagnostics
 * rollup feeds {@link ProjectDiagnosticsStrip}.
 *
 * Wording lives in the i18n catalogs, never here: the backend returns machine
 * codes (`health`, `reason`) and the strip localizes them.
 */
import { request } from './builderforceApi';

export type ProjectConnectionKind = 'source_control' | 'board';

/** ok = reachable/syncing · degraded = syncing with errors · error = broken · unknown = not probed. */
export type ProjectConnectionHealth = 'ok' | 'degraded' | 'error' | 'unknown';

export type ProjectConnectionReason =
  | 'no_credential'
  | 'unauthorized'
  | 'not_found'
  | 'rate_limited'
  | 'provider_error'
  | 'disabled'
  | 'not_probed'
  | null;

export type ProjectBuildStatus = 'success' | 'failure' | 'pending' | 'cancelled' | null;

export interface ProjectConnection {
  kind: ProjectConnectionKind;
  provider: string;
  /** `owner/repo` for source control; the external board id for a board. */
  label: string;
  url: string | null;
  health: ProjectConnectionHealth;
  reason: ProjectConnectionReason;
  isDefault: boolean;
  openPullRequests: number | null;
  /** True when the count covers only Builderforce-opened PRs (no live probe). */
  openPullRequestsRecordedOnly: boolean;
  buildStatus: ProjectBuildStatus;
  buildUrl: string | null;
  buildBranch: string | null;
  buildAt: string | null;
  /** When the delivery sweep last reached this repo's provider. Null = never yet.
   *  The verdict's AGE — a swept answer can be stale, and saying so is the honest
   *  alternative to letting a five-minute-old green read as a live one. */
  buildProbedAt: string | null;
  lastSyncedAt: string | null;
}

export interface ProjectConnectionsSummary {
  projectId: number;
  connections: ProjectConnection[];
}

/**
 * Every project's connections for the current tenant, keyed by project id.
 * Resolves to an EMPTY map on failure — connection status is an enhancement to
 * the widget, never a reason for the projects list to show an error.
 */
export async function fetchProjectConnections(): Promise<Map<number, ProjectConnection[]>> {
  return request<{ connections: ProjectConnectionsSummary[] }>('/api/projects/connections')
    .then((r) => new Map((r.connections ?? []).map((p) => [p.projectId, p.connections])))
    .catch(() => new Map<number, ProjectConnection[]>());
}
