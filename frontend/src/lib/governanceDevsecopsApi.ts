/**
 * Governance DevSecOps client (PRD 08 §10): on-demand branch scans, automated SOC 2 evidence, the
 * governance-auditor's gaps, and data-subject-request execution. All segment-scoped server-side;
 * the writes are manager-gated.
 */
import { apiRequest, apiRequestStream } from './apiClient';
import { filenameFromResponse } from './download';

export interface ScannableRepo {
  id: string;
  provider: string;
  owner: string;
  repo: string;
  defaultBranch: string | null;
}

export interface BranchScanResult {
  branch: string;
  scans: Array<{ scanId: string; scanType: string; status: 'completed' | 'skipped' | 'failed' }>;
  filesRead: number;
  truncated: boolean;
  unreadable: string | null;
  incidentsOpened: number;
}

export interface SocEvidenceEntry {
  id: string;
  controlId: string;
  controlRef: string;
  title: string;
  evidenceType: string;
  url: string | null;
  note: string | null;
  sourceRef: string | null;
  uploadedBy: string | null;
  createdAt: string;
}

export type GovernanceGapType = 'merged_pr_unscanned' | 'merged_pr_unreviewed' | 'control_no_evidence';

export interface GovernanceGap {
  id: string;
  gapType: GovernanceGapType;
  subjectRef: string;
  controlId: string | null;
  detail: string | null;
  detectedAt: string;
}

export type DsrDisposition = 'export' | 'suppress_and_erase' | 'suppress' | 'manual';

export interface DsrExecutionResult {
  status: 'completed' | 'processing';
  disposition: DsrDisposition;
  suppressionAdded: boolean;
  exported: Record<string, number>;
  erased: Record<string, number>;
  outstanding: string[];
  /** Set when an export was prepared; the download is manager-only. The storage key never reaches the client. */
  exportUrl: string | null;
  deliveredAt: string | null;
  note: string | null;
}

/** What executing a request would do - decided by the API, never re-derived here. */
export interface DsrPlan { disposition: DsrDisposition; verified: boolean; status: string }

export interface OpenPullRequest { id: string; number: number | null; url: string | null; branchName: string | null }

const json = { 'content-type': 'application/json' };

export const listScannableRepos = (): Promise<ScannableRepo[]> =>
  apiRequest<ScannableRepo[]>('/api/governance/vuln-scans/repositories');

export const runBranchScan = (repoId: string, ref?: string): Promise<BranchScanResult> =>
  apiRequest<BranchScanResult>('/api/governance/vuln-scans/run', {
    method: 'POST', headers: json, body: JSON.stringify({ repoId, ...(ref?.trim() ? { ref: ref.trim() } : {}) }),
  });

export const listSocEvidence = (): Promise<SocEvidenceEntry[]> =>
  apiRequest<SocEvidenceEntry[]>('/api/governance/soc2/evidence');

export const listGovernanceGaps = (): Promise<GovernanceGap[]> =>
  apiRequest<GovernanceGap[]>('/api/governance/soc2/gaps');

export const planDsr = (id: string): Promise<DsrPlan> =>
  apiRequest<DsrPlan>(`/api/governance/dsr/${encodeURIComponent(id)}/plan`);

export const executeDsr = (id: string): Promise<{ ok: true; result: DsrExecutionResult }> =>
  apiRequest(`/api/governance/dsr/${encodeURIComponent(id)}/execute`, { method: 'POST', headers: json, body: '{}' });

/** A manager records that the subject's identity was verified - the only way `verifiedAt` is set. */
export const verifyDsrIdentity = (id: string): Promise<{ ok: true; verifiedAt: string }> =>
  apiRequest(`/api/governance/dsr/${encodeURIComponent(id)}/verify-identity`, { method: 'POST', headers: json, body: '{}' });

export const markDsrDelivered =(id: string): Promise<{ ok: true; result: DsrExecutionResult }> =>
  apiRequest(`/api/governance/dsr/${encodeURIComponent(id)}/deliver`, { method: 'POST', headers: json, body: '{}' });

/** The persisted export as a Blob (authenticated fetch - a plain link would carry no credentials). */
export async function fetchDsrExport(id: string): Promise<{ blob: Blob; filename: string }> {
  const res = await apiRequestStream(`/api/governance/dsr/${encodeURIComponent(id)}/export`);
  if (!res.ok) throw new Error(`export download failed (${res.status})`);
  return { blob: await res.blob(), filename: filenameFromResponse(res, `dsr-${id}.json`) };
}

export const listOpenPullRequests = (): Promise<OpenPullRequest[]> =>
  apiRequest<OpenPullRequest[]>('/api/governance/vuln-scans/pr/open');

/**
 * Why the security gate holds a PR, as DATA. The UI words each one in the viewer's language
 * (`pullRequestSecurityGate.reason.<code>`); `message` is English, for logs, and is never displayed.
 * A code this client does not know renders as a generic "blocked by security policy".
 */
export const GATE_REASON_CODES = [
  'scan_missing', 'scan_pending', 'scan_skipped', 'scan_failed', 'scan_truncated', 'scan_no_segment',
  'no_head', 'unpinned_allow', 'ci_not_on_head', 'open_blocker', 'open_blocker_more',
  'no_pr_row', 'no_pr_for_task', 'no_pr_at_commit', 'no_pr_judged',
  'scan_scheduled', 'scan_unscheduled', 'step_failed', 'step_not_run', 'step_unavailable',
] as const;

export interface GateReason {
  code: string;
  message?: string;
  scanType?: string;
  count?: number;
  detail?: string;
  severity?: string;
  source?: 'scan' | 'review';
}

/** The PR's head commit now and why the gate holds it - what the accept-risk dialog shows. */
export interface PrGateState { headSha: string | null; allowed: boolean; overridden: boolean; reasons: GateReason[] }

export const getPrGate = (prId: string): Promise<PrGateState> =>
  apiRequest<PrGateState>(`/api/governance/vuln-scans/pr/${encodeURIComponent(prId)}/gate`);

/** `expectedHeadSha` is the commit the manager was SHOWN; the server answers 409 if the head has moved. */
export const acceptPrRisk = (prId: string, reason: string, expectedHeadSha: string): Promise<{ headSha: string; alreadyAccepted: boolean }> =>
  apiRequest(`/api/governance/vuln-scans/pr/${encodeURIComponent(prId)}/accept-risk`, {
    method: 'POST', headers: json, body: JSON.stringify({ reason, expectedHeadSha }),
  });
