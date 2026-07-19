/**
 * Remediation-status derivation — the SINGLE source that turns a diagnostic's
 * filed remediation tickets into the "remediation PR" signal the project-card /
 * analytics strip surfaces (matching the marketing SOC 2 gauge's "Remediation PR
 * opened" badge).
 *
 * `AuditRunner.runAudit` files remediation ticket(s) whose title is prefixed with
 * the audit's name (`${audit.name}: ${gap}` per-finding, or `${audit.name} — …`
 * bundled). Because the diagnostic `tool_runs` row does not store those task ids,
 * both the project score and the tenant rollup JOIN a project's tasks back to a
 * diagnostic BY TITLE PREFIX here, then derive a real PR/merge state from the
 * task's PR link + status — no schema change, one cheap tenant/project task read.
 */

/** Task lane keys that count as still-open (everything except a Done column). */
const DONE_STATUSES = new Set(['done']);

/** Whether a remediation ticket's lane counts as resolved (Done). */
export function isResolvedStatus(status: string | null | undefined): boolean {
  return DONE_STATUSES.has((status ?? '').trim().toLowerCase());
}

/** The remediation lifecycle a diagnostic's tickets are collectively in. */
export type RemediationState =
  /** No remediation ticket was filed for this diagnostic (fall back to gap count). */
  | 'none'
  /** Ticket(s) filed, none has an open PR yet, not all resolved. */
  | 'filed'
  /** At least one remediation PR is open (the marketing "Remediation PR opened"). */
  | 'pr_open'
  /** Every filed remediation ticket is resolved (Done). */
  | 'resolved';

export interface RemediationSummary {
  state: RemediationState;
  /** Remediation tickets matched to this diagnostic. */
  total: number;
  /** Of those, how many are still open (not Done). */
  open: number;
  /** The first remediation PR url found, if any (drives the badge's deep-link). */
  prUrl: string | null;
}

/** Minimal task shape the derivation needs (title + lane + PR link). */
export interface RemediationTaskRow {
  title: string;
  status: string | null;
  githubPrUrl: string | null;
}

/**
 * Whether a task title belongs to `auditName`'s remediation tickets. Matches the
 * exact bundled/per-gap title shapes AuditRunner mints: `${name}`, `${name}: …`,
 * or `${name} — …` / `${name} - …`. The delimiter check keeps one audit's name
 * from matching another whose name it is a prefix of.
 */
export function isRemediationTitleFor(title: string, auditName: string): boolean {
  const t = title.trim();
  const n = auditName.trim();
  if (!n) return false;
  return t === n || t.startsWith(`${n}:`) || t.startsWith(`${n} `);
}

/**
 * Derive the remediation status for one diagnostic from the project's tasks.
 * `tasks` is the full (non-archived) project task set; this filters to the ones
 * belonging to `auditName` and collapses them to a single lifecycle state.
 */
export function deriveRemediation(auditName: string, tasks: RemediationTaskRow[]): RemediationSummary {
  const matched = tasks.filter((t) => isRemediationTitleFor(t.title, auditName));
  if (matched.length === 0) return { state: 'none', total: 0, open: 0, prUrl: null };

  const open = matched.filter((t) => !isResolvedStatus(t.status)).length;
  const withPr = matched.find((t) => !!t.githubPrUrl && !isResolvedStatus(t.status)) ?? matched.find((t) => !!t.githubPrUrl);
  const prUrl = withPr?.githubPrUrl ?? null;

  let state: RemediationState;
  if (open === 0) state = 'resolved';
  else if (prUrl) state = 'pr_open';
  else state = 'filed';

  return { state, total: matched.length, open, prUrl };
}
