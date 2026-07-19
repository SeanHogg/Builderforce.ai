/**
 * AuditRunner — runs a system-level audit against a project and produces a
 * tracked diagnostic + a notification.
 *
 * Execution model (agent-primary with a deterministic fallback + backstop):
 *  1. Gather signals — read each connected repo's file tree (server-side, using
 *     the decrypted git token) and the project's governance/planning telemetry.
 *  2. Deterministic scan — run the audit's pure `scan(ctx)` to a `ToolResult`.
 *     This ALWAYS runs so a report lands instantly and the project rating always
 *     updates, even with no cloud runtime or repo credentials.
 *  3. Record + notify — persist via `ToolService.recordExternalRun` (a
 *     project-scoped `tool_runs` row) and fire an in-app `audit_complete`
 *     notification deep-linking to the report.
 *  4. File the agent ticket (best-effort) — create a board task briefing the
 *     security/audit agent to run the deep workflow + open a remediation PR. The
 *     caller (route) fires the existing lane-autorun trigger for it. If the board
 *     or an agent is unavailable this is skipped; the deterministic report stands.
 *
 * All IO lives here; the scanners (`auditScanners.ts`) stay pure/testable.
 */
import { and, eq, ne, inArray } from 'drizzle-orm';
import type { neon } from '@neondatabase/serverless';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { TaskType, TaskStatus } from '../../domain/shared/types';
import { projectRepositories, socControls, objectives, keyResults, projects, tasks } from '../../infrastructure/database/schema';
import { resolveRepoCredential, isResolveError } from '../repos/resolveRepoCredential';
import { listRepoFiles } from '../repos/readRepoContents';
import { notify } from '../notifications/notify';
import type { ToolService, SavedToolRun } from './ToolService';
import type { TaskService } from '../task/TaskService';
import { getSystemAudit } from './systemAudits';
import type { AuditScanContext, ScannedRepo } from './auditScanners';

type Sql = ReturnType<typeof neon<false, false>>;

export interface RunAuditArgs {
  tenantId: number;
  projectId: number;
  auditId: string;
  userId: string;
  /** Integration-encryption secret (INTEGRATION_ENCRYPTION_SECRET ?? JWT_SECRET). */
  secret: string;
}

export interface AuditRunOutcome {
  started: true;
  auditId: string;
  /** 'agent' when a remediation ticket was filed (deep pass dispatched), else
   *  'deterministic' (scan-only). Either way a report is produced. */
  mode: 'agent' | 'deterministic';
  run: SavedToolRun;
  /** The primary remediation ticket filed (the first, for back-compat) — the route
   *  fires lane autorun for it. */
  agentTask?: { taskId: number; status: string };
  /** All remediation tickets filed this run. One per gap when the audit is
   *  `ticketPerFinding` (each independently assignable/resolvable, like the
   *  Security agent's per-finding tickets); otherwise the single bundled ticket.
   *  The route fires lane autorun for every entry. */
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
const PRIVACY_POLICY_RE = /(privacy[-_]?policy|(^|\/)privacy(\.|\/|$))/i;
const TERMS_RE = /(terms[-_]?(of[-_]?(service|use))?|(^|\/)(tos|terms)(\.|\/|$))/i;
const COOKIE_POLICY_RE = /cookie[-_]?(policy|notice)/i;
const COOKIE_CONSENT_RE = /(cookie[-_]?(consent|banner)|consent[-_]?(banner|manager|mode|gate)|gdpr[-_]?consent|cookiebot|onetrust|osano|klaro|cookieconsent)/i;
const UNSUBSCRIBE_RE = /(unsubscribe|opt[-_]?out|list[-_]?unsubscribe|email[-_]?preferences|manage[-_]?subscription)/i;
const DATA_EXPORT_RE = /(data[-_]?export|export[-_]?data|download[-_]?(my[-_]?)?data|dsar|data[-_]?portability|export[-_]?account)/i;
const DATA_DELETION_RE = /(delete[-_]?account|account[-_]?deletion|right[-_]?to[-_]?(be[-_]?forgotten|erasure)|erasure|gdpr[-_]?delete|data[-_]?deletion|forget[-_]?me)/i;
const RETENTION_RE = /(retention|purge|data[-_]?ttl|expire[-_]?(records|data)|prune[-_]?(logs|data)|cleanup[-_]?(job|cron))/i;

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
    hasPrivacyPolicy: anyMatch(lower, PRIVACY_POLICY_RE),
    hasTermsOfService: anyMatch(lower, TERMS_RE),
    hasCookiePolicy: anyMatch(lower, COOKIE_POLICY_RE),
    hasCookieConsent: anyMatch(lower, COOKIE_CONSENT_RE),
    hasUnsubscribe: anyMatch(lower, UNSUBSCRIBE_RE),
    hasDataExport: anyMatch(lower, DATA_EXPORT_RE),
    hasDataDeletion: anyMatch(lower, DATA_DELETION_RE),
    hasRetentionPolicy: anyMatch(lower, RETENTION_RE),
  };
}

/** Statuses in the governance SOC 2 tracker that count as "implemented". */
const IMPLEMENTED_STATUSES = ['implemented', 'complete', 'completed', 'operating', 'done', 'passed', 'pass'];

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

    const [proj] = await this.db.select({ name: projects.name }).from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)));

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
        return { ...meta, read: true, ...signalsFromPaths(list.paths) };
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

  private async governanceSignal(tenantId: number) {
    const rows = await this.db.select({ status: socControls.status }).from(socControls)
      .where(eq(socControls.tenantId, tenantId));
    if (rows.length === 0) return undefined;
    const implemented = rows.filter((r) => IMPLEMENTED_STATUSES.includes((r.status ?? '').toLowerCase())).length;
    return { total: rows.length, implemented };
  }

  private async planningSignal(tenantId: number, projectId: number) {
    const objRows = await this.db.select({ id: objectives.id, initiativeId: objectives.initiativeId })
      .from(objectives)
      .where(and(eq(objectives.tenantId, tenantId), eq(objectives.projectId, projectId)));
    const objIds = objRows.map((o) => o.id);
    const krRows = objIds.length
      ? await this.db.select({ id: keyResults.id }).from(keyResults).where(inArray(keyResults.objectiveId, objIds))
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
  async runAudit(env: Env, sql: Sql, args: RunAuditArgs): Promise<AuditRunOutcome | null> {
    const audit = getSystemAudit(args.auditId);
    if (!audit) return null;

    const ctx = await this.buildContext(args);
    const result = audit.scan(ctx);

    const run = await this.toolService.recordExternalRun(env, {
      tenantId: args.tenantId,
      projectId: args.projectId,
      toolId: audit.id,
      result,
      createdBy: args.userId,
    });

    // In-app notification (+ optional email) deep-linking to the report.
    await notify(sql, env, {
      userId: args.userId,
      tenantId: args.tenantId,
      kind: 'audit_complete',
      title: `${audit.name} ready`,
      body: `${ctx.projectName}: ${result.headline}`,
      ref: `/projects?project=${args.projectId}&panel=diagnostics&audit=${encodeURIComponent(audit.id)}`,
    }).catch(() => {});

    // Best-effort: file the remediation ticket(s) for the audit agent. Left
    // unassigned — the board's lane-autorun trigger + owner-agent fallback
    // dispatches whichever security/audit agent is staffed on the lane; `persona`
    // carries the workflow hint.
    const agentTasks: Array<{ taskId: number; status: string }> = [];
    try {
      if (audit.ticketPerFinding && result.recommendations.length) {
        // One independently-resolvable ticket per gap (like the Security agent's
        // per-finding tickets), so each obligation is assigned + closed on its own.
        // Dedup: skip any gap that already has an OPEN remediation ticket, so
        // re-running the audit before a gap is fixed doesn't spam the board with
        // duplicates. Cheap one-shot lookup of the project's open task titles.
        const openTitles = await this.openTaskTitles(args.projectId);
        for (const rec of result.recommendations) {
          const title = `${audit.name}: ${rec.title}`.slice(0, 500);
          const titleKey = title.trim().toLowerCase();
          if (openTitles.has(titleKey)) continue; // an open ticket for this gap already exists
          const task = await this.taskService.createTask({
            projectId: args.projectId,
            title,
            description:
              `${rec.detail}\n\n` +
              `Filed by the ${audit.name} diagnostic against ${ctx.projectName} (${result.headline}). ` +
              `Fix this gap and open a remediation PR.`,
            taskType: TaskType.TASK,
            persona: audit.agentWorkflow,
          }, args.tenantId);
          agentTasks.push({ taskId: Number(task.id), status: task.status });
          openTitles.add(titleKey); // guard against duplicate gaps within one run
        }
      } else {
        const task = await this.taskService.createTask({
          projectId: args.projectId,
          title: `${audit.name} — ${ctx.projectName}`,
          description:
            `Run the ${audit.agentWorkflow} workflow across the connected repositories and this project, ` +
            `then open a remediation PR for the highest-priority findings.\n\n` +
            `First-pass automated report: ${result.headline}.\n` +
            (result.recommendations.length
              ? `Top gaps:\n${result.recommendations.slice(0, 5).map((r) => `- ${r.title}: ${r.detail}`).join('\n')}`
              : 'No automated gaps flagged — verify manually.'),
          taskType: TaskType.TASK,
          persona: audit.agentWorkflow,
        }, args.tenantId);
        agentTasks.push({ taskId: Number(task.id), status: task.status });
      }
    } catch {
      // No board/agent available — the deterministic report already landed.
    }

    const agentTask = agentTasks[0];
    return { started: true, auditId: audit.id, mode: agentTasks.length ? 'agent' : 'deterministic', run, agentTask, agentTasks };
  }

  /**
   * Lowercased titles of every OPEN (non-archived, not-Done) task in a project —
   * the dedup set for per-gap remediation filing. Best-effort: if the read fails
   * (or no db, as in unit tests) it returns an empty set so filing falls back to
   * the prior always-file behaviour rather than throwing.
   */
  private async openTaskTitles(projectId: number): Promise<Set<string>> {
    try {
      const rows = await this.db
        .select({ title: tasks.title })
        .from(tasks)
        .where(and(
          eq(tasks.projectId, projectId),
          eq(tasks.archived, false),
          ne(tasks.status, TaskStatus.DONE),
        ));
      return new Set(rows.map((r) => r.title.trim().toLowerCase()));
    } catch {
      return new Set();
    }
  }
}

function emptySignals(): Omit<ScannedRepo, 'provider' | 'owner' | 'repo' | 'defaultBranch' | 'read'> {
  return {
    hasCi: false, hasTests: false, hasReadme: false, hasLicense: false, hasSecurityPolicy: false,
    hasDependencyManifest: false, hasLockfile: false, hasCodeowners: false, hasContributing: false,
    suspectedSecrets: 0, fileCount: 0,
    hasPrivacyPolicy: false, hasTermsOfService: false, hasCookiePolicy: false, hasCookieConsent: false,
    hasUnsubscribe: false, hasDataExport: false, hasDataDeletion: false, hasRetentionPolicy: false,
  };
}
