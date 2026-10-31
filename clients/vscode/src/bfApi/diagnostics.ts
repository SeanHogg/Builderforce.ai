import type * as vscode from "vscode";
import { authed } from "./transport";

// ── Diagnostics (security & compliance system audits) ─────────────────────────
// The same `/api/tools` diagnostics engine the web app uses: a data-driven list of
// system audits (SOC 2, Architecture, Quality, Privacy & Data-Law) that run against
// a project's connected repos and record a per-project rating that rolls up to the
// workspace. See api/src/application/tools/systemAudits.ts.

/** A system-level audit type (mirrors the api `SystemAuditSummary`). */
interface BfSystemAudit {
  id: string;
  name: string;
  category: string;
  icon: string;
  blurb: string;
}

/** One diagnostic's latest result for a project (mirrors the api `ProjectDiagnostic`). */
export interface BfProjectDiagnostic {
  toolId: string;
  name: string;
  score: number | null;
  scoreLabel: string | null;
  headline: string;
  createdAt: string;
  result?: {
    codeAnalysis?: import('@builderforce/agent-tools').CodeAnalysisComparison;
    audit?: { runId: string; projectId: number; status: 'preview' | 'completed'; ticketIds: number[] };
    headline: string;
    summary?: string;
    metrics?: Array<{ label: string; value: string; hint?: string }>;
    recommendations?: Array<{ title: string; detail: string }>;
  };
}

/** A project's diagnostic rating (mirrors the api `ProjectScore`). */
interface BfProjectScore {
  result: { headline: string; summary?: string; score: number | null; scoreLabel: string | null };
  diagnostics: BfProjectDiagnostic[];
}

/**
 * The catalog of system audit types (GET /api/tools/audits). Public data — powers
 * the Diagnostics sidebar. Degrades to [] when signed out / unreachable.
 */
export async function listSystemAudits(secrets: vscode.SecretStorage): Promise<BfSystemAudit[]> {
  try {
    const r = await authed<{ audits: BfSystemAudit[] }>(secrets, "/api/tools/audits");
    return r?.audits ?? [];
  } catch {
    return [];
  }
}

/**
 * A project's diagnostic rating + each diagnostic's latest run (GET
 * /api/tools/projects/:id/score, manager+). Degrades to undefined when not a
 * manager / not deployed / project not owned, so the tree still lists the audit
 * types without scores.
 */
export async function getProjectDiagnostics(
  secrets: vscode.SecretStorage,
  projectId: number,
): Promise<BfProjectScore | undefined> {
  try {
    return await authed<BfProjectScore>(secrets, `/api/tools/projects/${projectId}/score`);
  } catch {
    return undefined;
  }
}

/**
 * Run a system audit against a project (POST /api/tools/audits/:id/run, manager+):
 * scores + records a report, notifies the user, and files the agent remediation
 * ticket. Returns true on success (202/201). Throws on non-2xx so the command layer
 * can surface WHY (e.g. 403 not a manager, 400 no repo).
 */
export async function runAudit(
  secrets: vscode.SecretStorage,
  auditId: string,
  projectId: number,
): Promise<boolean> {
  const r = await authed<{ started?: boolean }>(
    secrets,
    `/api/tools/audits/${encodeURIComponent(auditId)}/run`,
    { method: "POST", body: JSON.stringify({ projectId }) },
  );
  return !!r;
}
