/** Insights API contract — prescriptions (PRD 33). Re-exported by `../api.ts`; see its header. */
// ── S4e prescriptions (PRD 33 §5.1, D13) ─────────────────────────────────────

export type ReplayPrescriptionArea =
  | 'funnel' | 'ux' | 'site' | 'sales' | 'seo' | 'content' | 'performance' | 'accessibility';

export const REPLAY_PRESCRIPTION_AREAS: readonly ReplayPrescriptionArea[] = [
  'funnel', 'ux', 'site', 'sales', 'seo', 'content', 'performance', 'accessibility',
];

/** `replay_prescriptions.status` (§3.2). The last four are terminal. */
export type ReplayPrescriptionStatus =
  | 'proposed' | 'applied' | 'measuring' | 'worked' | 'no_effect' | 'worse' | 'dismissed';

/** What a prescription card offers (Fix it / Test it / Follow up / Ticket / Dismiss + the §5.2 page-review actions). */
export type ReplayPrescriptionActionKind =
  | 'fix' | 'test' | 'follow_up' | 'ticket' | 'dismiss' | 'apply_in_composer' | 'copy_prompt' | 'apply_page';

/** The `:action` segment of `REPLAY_PATHS.prescriptionAction`. */
export type ReplayPrescriptionRouteAction =
  | 'fix' | 'test' | 'start-test' | 'follow-up' | 'ticket' | 'dismiss' | 'publish-preview' | 'revert';

export const REPLAY_PRESCRIPTION_ROUTE_ACTIONS: readonly ReplayPrescriptionRouteAction[] = [
  'fix', 'test', 'start-test', 'follow-up', 'ticket', 'dismiss', 'publish-preview', 'revert',
];

/**
 * A 30-day impact range from the site's own data: affected × (conversion without −
 * with), Wilson interval on both cohorts. `estimate` is null (and `confidence` low)
 * below 100 visits in either cohort, or when the finding has no cohort to compare.
 */
export interface ReplayImpactDto {
  estimate: number | null;
  low: number | null;
  high: number | null;
  /** What the numbers count, e.g. `conversions`. */
  unit: string;
  confidence: 'low' | 'medium' | 'high';
  /** The projection horizon (30). */
  horizonDays: number;
  /** True when the cohorts are weighted kept recordings (the UI prints ≈). */
  estimated: boolean;
}

/** The deterministic finding: title params (rendered by the client from `ruleId`) and its evidence. */
export interface ReplayPrescriptionFindingDto {
  params: Record<string, string | number>;
  evidence: Array<{ recordingId: string; atMs: number }>;
  selector: string | null;
  label: string | null;
  /** The issue group's fingerprint (filter `issue` eq), when the finding is about one. */
  fingerprint: string | null;
  /** Visits the finding touched in the window. */
  affected: number;
}

export interface ReplayPrescriptionAcceptanceDto {
  metric: string;
  direction: 'up' | 'down';
  minVisits: number;
}

export interface ReplayPrescriptionMeasuredDto {
  before: number | null;
  after: number | null;
  delta: number | null;
  verdict: 'worked' | 'no_effect' | 'worse';
  /** Which verifier measured it. */
  source: 'ticket_effect' | 'ab_test' | 'follow_up';
  /** The release the verdict was measured on (the shipped fix), when there is one. */
  releaseKey: string | null;
  measuredAt: string;
}

export interface ReplayPrescriptionDto {
  id: string;
  ruleId: string;
  area: ReplayPrescriptionArea;
  source: 'rule' | 'observed';
  subjectKey: string;
  pagePath: string | null;
  status: ReplayPrescriptionStatus;
  finding: ReplayPrescriptionFindingDto;
  /** The AI's cited phrasing; null until drafted (top 5 a day per site). */
  prescription: string | null;
  /** The drafted change (`{ kind, description, target? }`), or a §5.2 `VisualPatch`. */
  change: unknown | null;
  visual: unknown | null;
  impact: ReplayImpactDto;
  /** The card's actions for this rule. */
  actions: ReplayPrescriptionActionKind[];
  /** What `REPLAY_PATHS.prescriptionAction` accepts right now (e.g. `revert` only on `worse` after a publish). */
  next: ReplayPrescriptionRouteAction[];
  actionKind: ReplayPrescriptionActionKind | null;
  /** Encoded refs of what the action created (`t=<taskId>;x=<testId>;p=<preview>;l=<live>;s=<sequence>`). */
  actionRef: string | null;
  /** Parsed `actionRef`. */
  refs: { taskId: number | null; testId: number | null; previewRelease: string | null; liveRelease: string | null; sequenceObjectId: string | null };
  acceptance: ReplayPrescriptionAcceptanceDto | null;
  measured: ReplayPrescriptionMeasuredDto | null;
  dismissReason: string | null;
  issueId: string | null;
  /** Rank within the list (1 = do first). */
  rank: number;
  createdAt: string;
  updatedAt: string;
}

/** `POST REPLAY_PATHS.prescriptionAction` body. Each action reads only its own fields. */
export interface ReplayPrescriptionActionInput {
  /** `dismiss`: required. */
  reason?: string;
  /** `fix`: the coding agent (`ide_agents.id`) to run it — a hosted site only. */
  agentRef?: string | null;
  /** `fix` / `ticket` on an external site: the project the ticket belongs to. */
  projectId?: number | null;
  /** `follow-up`: the `sequence` canvas object to enrol into. */
  sequenceObjectId?: string | null;
  /** `follow-up`: which matched contacts to enrol (default: all matched). */
  contactIds?: string[];
  /** `follow-up`: false (default) answers the preview; true enrols. */
  confirm?: boolean;
}

/** `follow-up` without `confirm`: what WOULD happen, shown before a person enrols anyone. */
export interface ReplayFollowUpPreviewDto {
  matched: Array<{ contactId: string; name: string; email: string }>;
  /** Identifiable visitors with no matching contact — counted, never listed. */
  unmatched: number;
  /** The drafted first touch, from the finding (never sent from here). */
  draft: { subject: string; body: string };
  /** Builderforce's own site, superadmin only: matched `sales_leads` ids for the broadcast composer. */
  platformLeadIds: string[];
  enrolled: number;
}

export interface ReplayPrescriptionActionResultDto {
  prescription: ReplayPrescriptionDto;
  taskId?: number | null;
  executionId?: number | null;
  /** Why a fix created a ticket but no run (no agent, external site, dispatcher refusal). */
  refusal?: string | null;
  testId?: number | null;
  followUp?: ReplayFollowUpPreviewDto | null;
}

export interface ReplayPrescriptionSweepResultDto {
  found: number;
  created: number;
  refreshed: number;
  prescribed: number;
}

/** The improvement ledger for one release: the fixes it shipped and their verdicts. */
export interface ReplayReleaseReportDto {
  releaseKey: string;
  label: string | null;
  firstSeenAt: string | null;
  prescriptions: Array<{
    id: string;
    ruleId: string;
    area: ReplayPrescriptionArea;
    status: ReplayPrescriptionStatus;
    actionKind: ReplayPrescriptionActionKind | null;
    measured: ReplayPrescriptionMeasuredDto | null;
  }>;
}
