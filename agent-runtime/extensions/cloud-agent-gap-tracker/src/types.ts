/**
 * Cloud Agent 50-Gap Tracker Types
 */

export type GapStatus = "Open" | "In Progress" | "Validated";

export type GapSeverity = "P0" | "P1" | "P2";

export type GapOwnerRole = "Security Lead" | "Engineering Manager" | "Backend Lead" | "Frontend Lead" | "QA Lead" | "Infrastructure Lead";

export interface Gap:
  | {
      id: string;
      title: string;
      severity: GapSeverity;
      status: GapStatus;
      description: string;
      owner: {
        name: string;
        role: GapOwnerRole;
        email?: string;
      };
      jiraTicket: {
        key: string;
        url: string;
        status: string;
      };
      validationEvidenceUrl?: string;
      createdAt: number;
      updatedAt: number;
      validatedAt?: number;
      closedAt?: number;
    }
  | {
      id: string;
      title: string;
      severity: GapSeverity;
      status: GapStatus;
      jiraTicket: {
        key: string;
        url: string;
        status: string;
      };
    };

export interface GapSummary {
  total: number;
  bySeverity: {
    P0: { open: number; validated: number; total: number };
    P1: { open: number; validated: number; total: number };
    P2: { open: number; validated: number; total: number };
  };
  byStatus: {
    Open: number;
    "In Progress": number;
    Validated: number;
  };
  open: number;
  validated: number;
  allClosed: boolean;
}

export interface GapTransitionRequest {
  gapId: string;
  newStatus: GapStatus;
  validatedBy?: string;
  notes?: string;
}

export interface GapFilter {
  status?: GapStatus;
  severity?: GapSeverity;
  ownerName?: string;
  minOpenSinceDays?: number;
}

export interface GapStats {
  totalGaps: number;
  openGaps: number;
  validatedGaps: number;
  openBySeverity: Record<string, number>;
  validationRate: number;
  averageTimeToClose: number | null;
}

export interface JiraSyncParams {
  apiKey: string;
  baseUrl: string;
  projectKey: string;
}

export interface SlackDigestParams {
  webhookUrl: string;
  channel: string;
  minDaysToReport: number;
}

export interface GapChange {
  gapId: string;
  gapTitle: string;
  delta: {
    before: { status: GapStatus; severity: GapSeverity };
    after: { status: GapStatus; severity: GapSeverity };
    statusChanged: boolean;
  };
  changedAt: number;
}

export interface DigestReport {
  periodStart: number;
  periodEnd: number;
  netClosedCount: number;
  summary: Array<{
    type: "closed" | "validated";
    gapId: string;
    gapTitle: string;
    delta: number;
    severity: GapSeverity;
  }>;
  bySeverity: {
    P0: number;
    P1: number;
    P2: number;
  };
  openCountBefore: number;
  openCountAfter: number;
}