import { reportCaughtError } from '../observability/caughtErrorReporter';
/** Shared audit coordinator. Preview scores are provisional; source findings and
 * remediation tickets must be persisted before a run completes. */
import { and, eq, lt, or, inArray, ne, desc } from 'drizzle-orm';
import type { CodeAnalysisSnapshot } from '@builderforce/agent-tools';
import { codeAnalysisFindings } from './codeAnalysisFindings';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { TaskType } from '../../domain/shared/types';

import { projectRepositories, socControls, objectives, keyResults, projects, systemAuditRuns, toolRuns, executions } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { resolveRepoCredential, isResolveError } from '../repos/resolveRepoCredential';
import { listRepoFiles, readRepoFile } from '../repos/readRepoContents';
import { notify } from '../notifications/notify';
import type { ToolService, SavedToolRun } from './ToolService';
import type { TaskService } from '../task/TaskService';

import { applyAuditFindings, type AuditFinding } from './auditDeepPass';

import { ensureRemediationTickets } from './auditRemediation';
import { getSystemAudit } from './systemAudits';
import { privacyContentSignals, selectPrivacyProbeFiles, type AuditScanContext, type ScannedRepo } from './auditScanners';
import { isControlImplemented } from '../governance/controlStatus';
import { advertisedName } from '../llm/toolNaming';
import { loadProjectInTenant } from '../project/projectOwnership';

export interface RunAuditArgs {
  tenantId: number;
  projectId: number;
  auditId: string;
  userId: string;
  /** Integration-encryption secret (INTEGRATION_ENCRYPTION_SECRET ?? JWT_SECRET). */
  secret: string;

  requestId?: string;
  executor?: 'local' | 'cloud';

  source?: Record<string, unknown>;
}

export interface AuditRunOutcome {
  started: true;

  runId: string;

  executor: 'local' | 'cloud';

  briefing: string;
  auditId: string;
  /** Retained for older clients; executor identifies where the agent will run. */
  mode: 'agent' | 'deterministic';
  run: SavedToolRun;
  /** Cloud source-review task, distinct from the findings' remediation tickets. */
  agentTask?: { taskId: number; status: string };
  /** Compatibility list containing the cloud source-review task, if any. */
  agentTasks?: Array<{ taskId: number; status: string }>;
}

// ── path-signal heuristics (cheap, no file-content reads) ─────────────────────

const base = (p: string) => p.split('/').pop() ?? p;
const anyMatch = (paths: string[], re: RegExp) => paths.some((p) => re.test(p));

const CI_RE = /(^|\/)(\.github\/workflows\/|\.gitlab-ci\.yml$|bitbucket-pipelines\.yml$|azure-pipelines\.yml$|\.circleci\/|\.buildkite\/|jenkinsfile$)/i;
const TEST_RE = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$/i;
const DEP_MANIFEST_RE = /(^|\/)(package\.json|requirements\.txt|pyproject\.toml|go\.mod|cargo\.toml|pom\.xml|build\.gradle|gemfile|composer\.json)$/i;
const LOCKFILE_RE = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|poetry\.lock|cargo\.lock|go\.sum|gemfile\.lock|composer\.lock)$/i;
const SECRET_RE = /(^|\/)(\.env(\.(local|production|prod|dev|development))?|id_rsa|id_dsa|.*\.pem|.*\.key|.*\.p12|.*\.pfx|credentials\.json|service[-_]?account.*\.json)$/i;

// ── privacy / data-law path heuristics (GDPR / CCPA·CPRA / CAN-SPAM) ───────────
const LEGAL_DOCUMENT_RE = /legal[-_]?(documents?|polic(y|ies))/i;
const PRIVACY_POLICY_RE = /(privacy[-_]?policy|(^|\/)privacy(\.|\/|$))/i;
const TERMS_RE = /(terms[-_]?(of[-_]?(service|use))?|(^|\/)(tos|terms)(\.|\/|$))/i;
const COOKIE_POLICY_RE = /cookie[-_]?(policy|notice)/i;
const COOKIE_CONSENT_RE = /(cookie[-_]?(consent|banner)|consent[-_]?(banner|manager|mode|gate)|gdpr[-_]?consent|cookiebot|onetrust|osano|klaro|cookieconsent)/i;
const UNSUBSCRIBE_RE = /(unsubscribe|opt[-_]?out|list[-_]?unsubscribe|email[-_]?preferences|manage[-_]?subscription)/i;
const DATA_EXPORT_RE = /(data[-_]?export|export[-_]?data|download[-_]?(my[-_]?)?data|dsar|data[-_]?portability|export[-_]?account)/i;
const DATA_DELETION_RE = /(delete[-_]?account|account[-_]?deletion|right[-_]?to[-_]?(be[-_]?forgotten|erasure)|erasure|gdpr[-_]?delete|data[-_]?deletion|forget[-_]?me)/i;
const RETENTION_RE = /(retention|purge|data[-_]?ttl|expire[-_]?(records|data)|prune[-_]?(logs|data)|cleanup[-_]?(job|cron))/i;
const RIGHTS_REQUEST_RE = /(privacy[-_]?request|data[-_]?subject[-_]?request|dsar|privacy[-_]?appeal)/i;
const UNIVERSAL_OPTOUT_RE = /(global[-_]?privacy[-_]?control|sec[-_]?gpc|universal[-_]?opt[-_]?out)/i;
const DPA_RE = /(^|\/)(dpa|data[-_]?processing[-_]?(agreement|addendum))([./_-]|$)/i;
const SUBPROCESSOR_RE = /(subprocessor|sub[-_]?processor|vendor[-_]?register)/i;
const DATA_INVENTORY_RE = /(record[-_]?of[-_]?processing|ropa|pii[-_]?(inventory|map)|data[-_]?(inventory|flow|map|lineage))/i;
const IMPACT_ASSESSMENT_RE = /(dpia|privacy[-_]?impact|data[-_]?protection[-_]?assessment|admt[-_]?(risk|impact)|ai[-_]?(risk|impact)[-_]?assessment)/i;
const PRIVACY_INCIDENT_RE = /(privacy[-_]?incident|data[-_]?breach|breach[-_]?(response|runbook|notification)|incident[-_]?response)/i;
const AI_TRANSPARENCY_RE = /(ai[-_]?(disclosure|notice|transparency)|automated[-_]?decision[-_]?(notice|disclosure)|bot[-_]?disclosure)/i;
const AUTOMATED_SAFEGUARD_RE = /(human[-_]?(review|oversight)|contest[-_]?(decision|result)|profiling[-_]?opt[-_]?out|automated[-_]?decision[-_]?(appeal|review|opt[-_]?out))/i;
const MINOR_SAFETY_RE = /(parental[-_]?consent|age[-_]?(gate|assurance|verification|estimate)|minor[-_]?(safety|privacy)|coppa|teen[-_]?safety|self[-_]?harm[-_]?response)/i;
const TRANSFER_RE = /(standard[-_]?contractual[-_]?clauses|(^|\/)sccs?([./_-]|$)|international[-_]?data[-_]?transfer|transfer[-_]?impact|uk[-_]?(idta|addendum)|cross[-_]?border[-_]?(assessment|transfer))/i;
const ACCESSIBILITY_RE = /(accessibility[-_]?(statement|audit|test)|wcag|axe[-_]?(core|playwright)|pa11y|lighthouse.*accessibility)/i;

/** Reduce a repo's file path list to the boolean/scalar signals a scan needs.
 *  Exported (pure) so the exact prod extraction can be reused/tested against a
 *  real repo tree without a live git connection. */
export function signalsFromPaths(paths: string[]): Omit<ScannedRepo, 'provider' | 'owner' | 'repo' | 'defaultBranch' | 'read'> {
  const lower = paths.map((p) => p.toLowerCase());
  const suspectedSecrets = lower.filter((p) => SECRET_RE.test(p) && !/\.example$|\.sample$|\.env\.example/i.test(p) && !p.endsWith('.pub')).length;
  return {
    hasCi: anyMatch(lower, CI_RE),
    hasTests: anyMatch(lower, TEST_RE),
    hasReadme: lower.some((p) => /^readme(\.|$)/i.test(base(p))),
    hasLicense: lower.some((p) => /^licen[cs]e(\.|$)/i.test(base(p))),
    hasSecurityPolicy: lower.some((p) => /(^|\/)(\.github\/)?security\.md$/i.test(p)),
    hasDependencyManifest: anyMatch(lower, DEP_MANIFEST_RE),
    hasLockfile: anyMatch(lower, LOCKFILE_RE),
    hasCodeowners: lower.some((p) => /(^|\/)(\.github\/|docs\/)?codeowners$/i.test(p)),
    hasContributing: lower.some((p) => /^contributing(\.|$)/i.test(base(p))),
    suspectedSecrets,
    fileCount: paths.length,
    hasPrivacyPolicy: anyMatch(lower, PRIVACY_POLICY_RE) || anyMatch(lower, LEGAL_DOCUMENT_RE),
    hasTermsOfService: anyMatch(lower, TERMS_RE) || anyMatch(lower, LEGAL_DOCUMENT_RE),
    hasCookiePolicy: anyMatch(lower, COOKIE_POLICY_RE),
    hasCookieConsent: anyMatch(lower, COOKIE_CONSENT_RE),
    hasUnsubscribe: anyMatch(lower, UNSUBSCRIBE_RE),
    hasDataExport: anyMatch(lower, DATA_EXPORT_RE),
    hasDataDeletion: anyMatch(lower, DATA_DELETION_RE),
    hasRetentionPolicy: anyMatch(lower, RETENTION_RE),
    hasRightsRequestWorkflow: anyMatch(lower, RIGHTS_REQUEST_RE),
    hasUniversalOptOut: anyMatch(lower, UNIVERSAL_OPTOUT_RE),
    hasDpa: anyMatch(lower, DPA_RE),
    hasSubprocessorRegister: anyMatch(lower, SUBPROCESSOR_RE),
    hasDataInventory: anyMatch(lower, DATA_INVENTORY_RE),
    hasImpactAssessment: anyMatch(lower, IMPACT_ASSESSMENT_RE),
    hasPrivacyIncidentResponse: anyMatch(lower, PRIVACY_INCIDENT_RE),
    hasAiTransparency: anyMatch(lower, AI_TRANSPARENCY_RE),
    hasAutomatedDecisionSafeguards: anyMatch(lower, AUTOMATED_SAFEGUARD_RE),
    hasMinorSafety: anyMatch(lower, MINOR_SAFETY_RE),
    hasTransferSafeguards: anyMatch(lower, TRANSFER_RE),
    hasAccessibilityEvidence: anyMatch(lower, ACCESSIBILITY_RE),
  };
}

/** Statuses in the governance SOC 2 tracker that count as "implemented". */


export class AuditRunner {
  constructor(
    private readonly db: Db,
    private readonly toolService: ToolService,
    private readonly taskService: TaskService,
  ) {}

  /** Gather all signals for a project into a pure scan context. Never throws —
   *  unreadable repos / missing telemetry degrade gracefully. */
  async buildContext(args: { tenantId: number; projectId: number; secret: string }): Promise<AuditScanContext> {
    const { tenantId, projectId, secret } = args;

    const proj = await loadProjectInTenant(this.db, tenantId, projectId, { name: projects.name });

    const repoRows = await this.db.select().from(projectRepositories)
      .where(and(eq(projectRepositories.projectId, projectId), eq(projectRepositories.tenantId, tenantId)));

    const repos: ScannedRepo[] = await Promise.all(repoRows.map(async (r): Promise<ScannedRepo> => {
      const meta = { provider: r.provider, owner: r.owner, repo: r.repo, defaultBranch: r.defaultBranch ?? 'main' };
      try {
        const resolved = await resolveRepoCredential(this.db, secret, tenantId, r.id);
        if (isResolveError(resolved)) return { ...meta, read: false, ...emptySignals() };
        const list = await listRepoFiles({
          provider: resolved.repo.provider,
          host: resolved.repo.host,
          owner: resolved.repo.owner,
          repo: resolved.repo.repo,
          token: resolved.token,
          ref: resolved.repo.defaultBranch ?? meta.defaultBranch,
        });
        if (!list.ok) return { ...meta, read: false, ...emptySignals() };
        const readCtx = {
          provider: resolved.repo.provider,
          host: resolved.repo.host,
          owner: resolved.repo.owner,
          repo: resolved.repo.repo,
          token: resolved.token,
          ref: resolved.repo.defaultBranch ?? meta.defaultBranch,
        };
        return {
          ...meta,
          read: true,
          ...signalsFromPaths(list.paths),
          verifiedPrivacy: await this.verifyPrivacyContent(readCtx, list.paths),
        };
      } catch {
        return { ...meta, read: false, ...emptySignals() };
      }
    }));

    const governance = await this.governanceSignal(tenantId).catch(() => undefined);
    const planning = await this.planningSignal(tenantId, projectId).catch(() => undefined);

    return {
      projectId,
      projectName: proj?.name ?? `Project #${projectId}`,
      reposConfigured: repoRows.length,
      repos,
      governance,
      planning,
    };
  }

  /**
   * Open the handful of files that decide whether a privacy control WORKS.
   *
   * The privacy scan used to establish GDPR/CCPA/CAN-SPAM controls from file
   * paths alone, so a route that exists but does not gate trackers or does not
   * truly delete scored exactly like one that does. These reads are what turn a
   * filename into evidence.
   *
   * Budgeted at `PRIVACY_PROBE_FILE_BUDGET` reads per repo and one candidate per
   * signal first, so a repo with fifty unsubscribe templates cannot spend the
   * whole allowance proving one control. Every failure degrades to the previous
   * path-only reading rather than to a false negative — `verifiedFrac` treats an
   * unopened file and a disproved one differently on purpose.
   */
  private async verifyPrivacyContent(
    ctx: Parameters<typeof readRepoFile>[0],
    paths: string[],
  ): Promise<ScannedRepo['verifiedPrivacy']> {
    const candidates = selectPrivacyProbeFiles(paths);
    if (!candidates.length) return undefined;
    const files: Array<{ path: string; content: string }> = [];
    for (const path of candidates) {
      const read = await readRepoFile(ctx, path).catch(() => null);
      if (read?.ok) files.push({ path, content: read.content });
    }
    return files.length ? privacyContentSignals(files) : undefined;
  }

  private async governanceSignal(tenantId: number) {
    const rows = await this.db.select({ status: socControls.status }).from(socControls)
      .where(eq(socControls.tenantId, tenantId));
    if (rows.length === 0) return undefined;
    const implemented = rows.filter((r) => isControlImplemented(r.status)).length;
    return { total: rows.length, implemented };
  }

  private async planningSignal(tenantId: number, projectId: number) {
    const objRows = await this.db.select({ id: objectives.id, initiativeId: objectives.initiativeId })
      .from(objectives)
      .where(and(eq(objectives.tenantId, tenantId), eq(objectives.projectId, projectId)));
    const objIds = objRows.map((o) => o.id);
    const krRows = objIds.length
      ? await this.db.select({ id: keyResults.id }).from(keyResults).where(scopedToTenant(keyResults, tenantId, inArray(keyResults.objectiveId, objIds)))
      : [];
    return {
      objectives: objRows.length,
      keyResults: krRows.length,
      initiatives: objRows.filter((o) => o.initiativeId != null).length,
      hasVisionDoc: false,
      hasRoadmap: objRows.some((o) => o.initiativeId != null),
    };
  }

  /** Run the audit end-to-end. */
  async runAudit(env: Env, args: RunAuditArgs): Promise<AuditRunOutcome | null> {
    const audit = getSystemAudit(args.auditId);
    if (!audit) return null;

    const ctx = await this.buildContext(args);
    const runId = args.requestId ?? crypto.randomUUID();
    const result = { ...audit.scan(ctx), audit: { runId, projectId: args.projectId, status: 'preview' as const, ticketIds: [] as number[] } };

    const run = await this.toolService.recordExternalRun(env, {
      tenantId: args.tenantId,
      projectId: args.projectId,
      toolId: audit.id,
      result,
      createdBy: args.userId,
    });

    const executor = args.executor ?? 'cloud';
    const [session] = await this.db.insert(systemAuditRuns).values({
      tenantId: args.tenantId, projectId: args.projectId, auditId: audit.id,
      id: runId,
      executor, baseline: result, reportId: run.id, createdBy: args.userId,
      source: args.source ?? {},
    }).returning();
    if (!session) throw new Error('Could not persist audit run');
    const briefing = `${audit.name}: ${audit.blurb}\n${audit.instructions}\nProject: ${args.projectId}. Audit: ${audit.id}. Run: ${session.id}.\n`
      + `Inspect the actual source and run the relevant available static checks and tests. Report evidence, source locations, recommendations, and skipped checks. `
      + `Audit only; do not modify source or open remediation PRs during this run. `
      + `When finished call ${advertisedName('audits.report_findings')} with projectId ${args.projectId}, auditId "${audit.id}", runId "${session.id}" and every finding. Report an empty array for a clean pass. `
      + `The platform creates remediation tickets. Do not create duplicate tickets yourself. `
      + (executor === 'cloud' ? 'Audit the connected repository checkout. Local branch and dirty-state metadata are context only; local edits are not uploaded. Record the actual checkout commit in your report. ' : 'Audit the local workspace on disk, including local changes. Record the inspected files and any source changes during the audit. ')
      + `Source context: ${JSON.stringify(args.source ?? {})}`;
    let agentTask: { taskId: number; status: string } | undefined;
    if (executor === 'cloud') {
      try {
        const task = await this.taskService.createTask({
          projectId: args.projectId, title: `Audit execution: ${audit.name} — ${ctx.projectName}`,
          description: briefing, taskType: TaskType.TASK, persona: audit.agentWorkflow,
          createdVia: 'security_audit',
        }, args.tenantId);
        agentTask = { taskId: Number(task.id), status: task.status };
        await this.db.update(systemAuditRuns).set({ taskId: agentTask.taskId }).where(and(eq(systemAuditRuns.id, session.id), eq(systemAuditRuns.tenantId, args.tenantId)));
      } catch (error) {
        await this.setRunStatus(args.tenantId, session.id, 'failed', String(error));
        throw error;
      }
    }
    return { started: true, runId: session.id, executor, briefing, auditId: audit.id,
      mode: 'agent', run, agentTask, agentTasks: agentTask ? [agentTask] : [] };
  }
  async setRunStatus(tenantId: number, runId: string, status: string, error: string | null = null): Promise<void> {
    await this.db.update(systemAuditRuns).set({ status, error, updatedAt: new Date() })
      .where(and(eq(systemAuditRuns.tenantId, tenantId), eq(systemAuditRuns.id, runId),
        status === 'running' ? inArray(systemAuditRuns.status, ['queued', 'blocked', 'failed']) : ne(systemAuditRuns.status, 'completed')));
  }
  async getRun(tenantId: number, projectId: number, runId: string) {
    await loadProjectInTenant(this.db, tenantId, projectId, { id: projects.id });
    const [run] = await this.db.select().from(systemAuditRuns).where(and(
      eq(systemAuditRuns.tenantId, tenantId), eq(systemAuditRuns.projectId, projectId), eq(systemAuditRuns.id, runId),
    )).limit(1);
    if (!run) return null;
    if (run.status === 'running' && run.executionId) {
      const [execution] = await this.db.select({ status: executions.status, error: executions.errorMessage }).from(executions)
        .where(and(eq(executions.id, run.executionId), eq(executions.tenantId, tenantId))).limit(1);
      if (execution && ['failed', 'cancelled', 'completed'].includes(execution.status)) {
        const error = execution.error ?? 'The agent stopped without saving audit findings. Resume the audit conversation or retry the run.';
        await this.setRunStatus(tenantId, runId, 'failed', error);
        run.status = 'failed'; run.error = error;
      }
    }
    const [report] = run.reportId ? await this.db.select({ result: toolRuns.result }).from(toolRuns).where(and(
      eq(toolRuns.id, run.reportId), eq(toolRuns.tenantId, tenantId), eq(toolRuns.projectId, projectId),
    )).limit(1) : [];
    return { ...run, result: report?.result };
  }

  async bindExecution(tenantId: number, runId: string, executionId: number): Promise<void> {
    await this.db.update(systemAuditRuns).set({ executionId })
      .where(and(eq(systemAuditRuns.tenantId, tenantId), eq(systemAuditRuns.id, runId)));
  }
  async reportFindings(env: Env, args: { tenantId: number; projectId: number; auditId: string; runId: string; findings: AuditFinding[]; analysis?: CodeAnalysisSnapshot; userId: string }) {
    const session = await this.getRun(args.tenantId, args.projectId, args.runId);
    if (!session || session.auditId !== args.auditId) return null;
    // Immutable findings on retries, and the original baseline prevents repeated score penalties.
    if (session.status === 'completed') return { runId: session.id, completed: true, ticketIds: session.ticketIds };
    const available = or(
      inArray(systemAuditRuns.status, ['running', 'queued', 'blocked', 'failed', 'remediation_pending']),
      and(eq(systemAuditRuns.status, 'reporting'), lt(systemAuditRuns.updatedAt, new Date(Date.now() - 180_000))),
    );
    const [claim] = await this.db.update(systemAuditRuns).set({
      findings: session.findings ?? [...args.findings, ...codeAnalysisFindings((session.analysis ?? args.analysis) as CodeAnalysisSnapshot | undefined)], status: 'reporting', updatedAt: new Date(),
      analysis: session.analysis ?? args.analysis ?? null,
    }).where(and(eq(systemAuditRuns.id, session.id), eq(systemAuditRuns.tenantId, args.tenantId), available)).returning();
    if (!claim) throw new Error('Another report is saving this audit; retry shortly.');
    const findings = claim.findings as AuditFinding[];
    try {
      const current = claim.analysis as CodeAnalysisSnapshot | null;
      let baseline: CodeAnalysisSnapshot | undefined;
      if (current) {
        const previous = await this.db.select({ result: toolRuns.result }).from(toolRuns).where(and(
          eq(toolRuns.tenantId, args.tenantId), eq(toolRuns.projectId, args.projectId), eq(toolRuns.toolId, args.auditId),
          lt(toolRuns.createdAt, session.createdAt),
        )).orderBy(desc(toolRuns.createdAt)).limit(20);
        baseline = previous.map((row) => (row.result as import('./toolTypes').ToolResult).codeAnalysis?.current)
          .find((old) => old && old.source.branch === current.source.branch && old.source.scope === current.source.scope && old.source.repository === current.source.repository);
      }
      const ticketIds = await ensureRemediationTickets(this.db, this.taskService, {
        ...args, auditName: getSystemAudit(args.auditId)!.name, findings,
      });
      const report = await applyAuditFindings(this.db, this.toolService, env, {
        ...args, findings, createdBy: args.userId,
        ...(current ? { codeAnalysis: { current, ...(baseline ? { baseline } : {}) } } : {}),
        audit: { runId: session.id, projectId: args.projectId, status: 'completed', ticketIds },
        baseline: { ...(session.baseline as import('./toolTypes').ToolResult), recommendations: [] },
      });
      if (!report) throw new Error('Could not save audit report');
      await this.db.update(systemAuditRuns).set({ status: 'completed', reportId: report.id, ticketIds, error: null, updatedAt: new Date() })
        .where(and(eq(systemAuditRuns.id, session.id), eq(systemAuditRuns.tenantId, args.tenantId)));
      await notify(this.db, env, {
        userId: session.createdBy, tenantId: args.tenantId, kind: 'audit_complete',
        title: `${getSystemAudit(args.auditId)!.name} ready`, body: report.result.headline,
        ref: `/projects?project=${args.projectId}&panel=diagnostics&audit=${encodeURIComponent(args.auditId)}`,
      }).catch((error) => reportCaughtError(error, { source: 'application/tools/AuditRunner.ts', operation: 'notifyAuditComplete' }));
      return { runId: session.id, completed: true, report, ticketIds };
    } catch (error) {
      await this.setRunStatus(args.tenantId, session.id, 'remediation_pending', String(error));
      throw error;
    }
  }

  /** Durable retry of reports whose findings landed but ticket/report persistence was interrupted. */
  async retryPending(env: Env): Promise<number> {
    const pending = await this.db.select().from(systemAuditRuns).where(and(
      inArray(systemAuditRuns.status, ['remediation_pending', 'reporting']),
      lt(systemAuditRuns.updatedAt, new Date(Date.now() - 180_000)),
    )).limit(10);
    let completed = 0;
    for (const run of pending) {
      try {
        await this.reportFindings(env, {
          tenantId: run.tenantId, projectId: run.projectId, auditId: run.auditId,
          runId: run.id, findings: (run.findings ?? []) as AuditFinding[], userId: run.createdBy,
        });
        completed++;
      } catch (error) {
        reportCaughtError(error, { source: 'application/tools/AuditRunner.ts', operation: 'retryPending' });
      }
    }
    return completed;
  }
}

function emptySignals(): Omit<ScannedRepo, 'provider' | 'owner' | 'repo' | 'defaultBranch' | 'read'> {
  return {
    hasCi: false, hasTests: false, hasReadme: false, hasLicense: false, hasSecurityPolicy: false,
    hasDependencyManifest: false, hasLockfile: false, hasCodeowners: false, hasContributing: false,
    suspectedSecrets: 0, fileCount: 0,
    hasPrivacyPolicy: false, hasTermsOfService: false, hasCookiePolicy: false, hasCookieConsent: false,
    hasUnsubscribe: false, hasDataExport: false, hasDataDeletion: false, hasRetentionPolicy: false,
    hasRightsRequestWorkflow: false, hasUniversalOptOut: false, hasDpa: false,
    hasSubprocessorRegister: false, hasDataInventory: false, hasImpactAssessment: false,
    hasPrivacyIncidentResponse: false, hasAiTransparency: false,
    hasAutomatedDecisionSafeguards: false, hasMinorSafety: false,
    hasTransferSafeguards: false, hasAccessibilityEvidence: false,
  };
}
