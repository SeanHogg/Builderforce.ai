/**
 * buildStatus — the ONE derivation of "what is the build doing on this ticket?".
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────
 * A failing PR-branch build was visible on the ticket's PR tab and NOWHERE else. The
 * board card and the execution chip — the two surfaces a person actually scans — showed
 * a ticket sitting in review with a green-looking chip while its branch could not build,
 * so the only way to find a red build was to open each ticket in turn. A verdict CI
 * already wrote and the platform already stored was, in practice, unreadable.
 *
 * ── ONE DERIVATION, BECAUSE THERE WERE ALREADY TWO ───────────────────────────────
 * `normalizeBuildStatus` existed verbatim in ManagerService and again in triageStage —
 * the same five-token narrowing of a free-form `varchar(16)`, in two files, each able to
 * drift from the other. It lives here now and both import it, together with the badge
 * vocabulary the surfaces render.
 *
 * ── WHY "THE CURRENT PR" IS A DECISION AND NOT A SORT ────────────────────────────
 * A ticket can carry an old settled pull request AND a live one. The LIVE one decides
 * both whether there is anything left to land and whose build verdict matters, so an open
 * row beats every other row regardless of timestamps — reading "whichever row the scan
 * returned last" is how a settled PR's green build could speak for an open PR that had
 * not built at all. With no open row the newest row wins, which is the post-merge build
 * of the thing that actually shipped.
 *
 * Pure: no imports, no IO. The callers do the reading.
 */

/** The vocabulary `pull_requests.build_status` is written in (free-form varchar(16)). */
export type RawBuildStatus = 'success' | 'failure' | 'pending' | null;

/**
 * The vocabulary the SURFACES render. `unknown` is a first-class member, not an absence:
 * a ticket with no pull request and a ticket whose build has never reported are the same
 * thing to a reader — nothing to say — and both must render no badge rather than a
 * green one.
 */
export type TicketBuildStatus = 'passing' | 'failing' | 'pending' | 'unknown';

/** Narrow the free-form column to the readiness vocabulary. Anything else is absent. */
export function normalizeBuildStatus(v: string | null | undefined): RawBuildStatus {
  return v === 'success' || v === 'failure' || v === 'pending' ? v : null;
}

/** The columns any "which PR speaks for this ticket" decision needs. */
export interface PrBuildRow {
  status: string | null;
  buildStatus: string | null;
}

/**
 * The pull request whose build verdict speaks for the ticket: the OPEN one if there is
 * one, else the first row given. Callers must supply rows NEWEST FIRST so the fallback
 * is the most recent settled PR.
 */
export function pickCurrentPr<T extends PrBuildRow>(rows: readonly T[]): T | null {
  let fallback: T | null = null;
  for (const row of rows) {
    if (row.status === 'open') return row;
    if (!fallback) fallback = row;
  }
  return fallback;
}

/** The badge verdict for one ticket's current pull request. */
export function deriveBuildStatus(pr: PrBuildRow | null | undefined): TicketBuildStatus {
  const raw = normalizeBuildStatus(pr?.buildStatus);
  if (raw === 'success') return 'passing';
  if (raw === 'failure') return 'failing';
  if (raw === 'pending') return 'pending';
  return 'unknown';
}

/** The same verdict straight from a ticket's PR rows (newest first). */
export function deriveBuildStatusFromRows(rows: readonly PrBuildRow[]): TicketBuildStatus {
  return deriveBuildStatus(pickCurrentPr(rows));
}
