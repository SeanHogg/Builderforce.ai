import { and, eq, desc, isNotNull, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached, invalidateCached, projectScoreCacheKey, tenantRollupCacheKey } from '../../infrastructure/cache/readThroughCache';
import { toolRuns, projects, tasks } from '../../infrastructure/database/schema';
import { deriveRemediation, type RemediationSummary, type RemediationTaskRow } from './remediationStatus';
import { TOOLS, getTool } from './toolDefinitions';
import { TOOL_DATA_PROVIDERS, hasDataProvider } from './toolDataProviders';
import { toSummary, toDefinition, type ToolSummary, type ToolDefinition, type ToolResult } from './toolTypes';

import { ARCHITECTURE_DIAGNOSTIC_ID, EXTERNAL_DIAGNOSTIC_NAMES, EXTERNAL_DIAGNOSTIC_ICONS } from './auditIds';

/** Re-exported so existing importers (e.g. AnalysisRunnerDO) keep their import
 *  path. The canonical definition lives in `auditIds.ts` alongside the other
 *  system-audit ids and their display names. */
export { ARCHITECTURE_DIAGNOSTIC_ID };

const LEVEL_NAMES = ['Initial', 'Managed', 'Defined', 'Quantitatively Managed', 'Optimizing'];
const clampLevel = (n: number): number => Math.max(1, Math.min(5, Math.round(n)));
const levelName = (n: number): string => LEVEL_NAMES[clampLevel(n) - 1]!;

/** Display name for any diagnostic id — a registered tool, or a special
 *  externally-scored diagnostic like the architecture analysis. */
export function diagnosticName(toolId: string): string {
  return getTool(toolId)?.name ?? EXTERNAL_DIAGNOSTIC_NAMES[toolId] ?? toolId;
}

/** Emoji icon for any diagnostic id — the system-audit icon, else the registered
 *  tool's icon, else a neutral fallback. Lets every surface (project-card strip,
 *  analytics gauges) label a diagnostic without re-deriving the mapping. */
export function diagnosticIcon(toolId: string): string {
  return EXTERNAL_DIAGNOSTIC_ICONS[toolId] ?? getTool(toolId)?.icon ?? '📊';
}

export interface SavedToolRun {
  id: string;
  toolId: string;
  kind: string;
  projectId: number | null;
  input: Record<string, number>;
  result: ToolResult;
  createdBy: string | null;
  createdAt: string;
}

/** One diagnostic's latest result for a project. */
export interface ProjectDiagnostic {
  toolId: string;
  name: string;
  /** Emoji icon for the diagnostic (audit / tool). */
  icon: string;
  score: number | null;
  scoreLabel: string | null;
  headline: string;
  /** Number of open gaps (recommendations) the latest run flagged — the
   *  "remediation outstanding" signal surfaced beside the score. */
  gapCount: number;
  /** Real remediation status derived from the diagnostic's filed ticket(s):
   *  filed / PR-open / resolved (the marketing "Remediation PR opened" badge).
   *  `state: 'none'` when no remediation ticket exists (fall back to gapCount). */
  remediation: RemediationSummary;
  kind: string;
  createdAt: string;
  /** The full latest run result, for the per-diagnostic results view. */
  result: ToolResult;
}

export interface ProjectScore {
  /** Aggregate result, ready for the generic ToolResultView (meter + breakdown). */
  result: ToolResult;
  diagnostics: ProjectDiagnostic[];
}

/** Compact per-diagnostic summary carried on a rollup row so the project-card
 *  strip can render each diagnostic (SOC 2 etc.) without an N+1 score fetch. */
export interface ProjectDiagnosticSummary {
  toolId: string;
  name: string;
  icon: string;
  score: number | null;
  scoreLabel: string | null;
  gapCount: number;
  /** Real remediation status (filed / PR-open / resolved), so the project card
   *  shows the true remediation signal, not just the raw gap count. */
  remediation: RemediationSummary;
}

export interface TenantProjectScore {
  projectId: number;
  name: string;
  score: number | null;
  scoreLabel: string | null;
  diagnosticCount: number;
  lastRunAt: string;
  /** Per-diagnostic latest scores for this project (SOC 2, Quality, …), so the
   *  project card can surface each one from the single cached rollup read. */
  diagnostics: ProjectDiagnosticSummary[];
}

export interface TenantDiagnosticsRollup {
  result: ToolResult;
  projects: TenantProjectScore[];
}

const runsKey = (tenantId: number, toolId: string, projectId?: number | null) =>
  `tools:runs:tenant:${tenantId}:${toolId}:project:${projectId ?? 'none'}`;
const dataKey = (tenantId: number, toolId: string, days: number, projectId?: number | null) =>
  `tools:data:tenant:${tenantId}:${toolId}:days:${days}:project:${projectId ?? 'none'}`;
// Diagnostics score/rollup cache keys — shared in readThroughCache so a task PR/status
// transition invalidates the SAME keys (keeps the remediation badge from lagging).
const projectScoreKey = projectScoreCacheKey;
const rollupKey = tenantRollupCacheKey;

/** Mean of the non-null scores, rounded to one decimal, or null if none. */
function meanScore(scores: Array<number | null | undefined>): number | null {
  const nums = scores.filter((s): s is number => typeof s === 'number');
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

export class ToolService {
  constructor(private readonly db: Db) {}

  /**
   * Non-archived tasks (title + lane + PR link) for the given projects, grouped by
   * projectId — the join source for deriving each diagnostic's real remediation
   * status. One query for the whole rollup / project score. Best-effort: returns an
   * empty map on failure so scoring never blocks on the task read.
   */
  private async remediationTasksByProject(projectIds: number[]): Promise<Map<number, RemediationTaskRow[]>> {
    const byProject = new Map<number, RemediationTaskRow[]>();
    if (projectIds.length === 0) return byProject;
    try {
      const rows = await this.db
        .select({
          projectId: tasks.projectId,
          title: tasks.title,
          status: tasks.status,
          githubPrUrl: tasks.githubPrUrl,
        })
        .from(tasks)
        .where(and(inArray(tasks.projectId, projectIds), eq(tasks.archived, false)));
      for (const r of rows) {
        const list = byProject.get(r.projectId) ?? [];
        list.push({ title: r.title, status: r.status, githubPrUrl: r.githubPrUrl });
        byProject.set(r.projectId, list);
      }
    } catch {
      // Task read failed — diagnostics still score, remediation just shows 'none'.
    }
    return byProject;
  }

  /** Public — list every free tool (client-safe summaries + data-mode flag). */
  list(): ToolSummary[] {
    return TOOLS.map((t) => ({ ...toSummary(t), hasDataDriven: hasDataProvider(t.id) }));
  }

  /** Public — a tool's full definition (questions / inputs, no compute fn). */
  getDefinition(id: string): ToolDefinition | null {
    const tool = getTool(id);
    if (!tool) return null;
    return { ...toDefinition(tool), hasDataDriven: hasDataProvider(id) };
  }

  /**
   * Pure compute — runs the tool's scorer over the supplied input
   * (calculator values or questionnaire answers). No tenant data is read, so
   * this is safe to expose publicly for the free preview.
   */
  compute(id: string, input: Record<string, number>): ToolResult | null {
    const tool = getTool(id);
    if (!tool) return null;
    return tool.kind === 'calculator' ? tool.compute(input) : tool.score(input);
  }

  /** Whether a tool has a telemetry-derived "from your data" mode. */
  hasDataDriven(id: string): boolean {
    return hasDataProvider(id);
  }

  /** Data-driven result from this workspace's telemetry, cached. Null if no provider.
   *  When projectId is set the result is scoped to that project. */
  async getDataDriven(env: Env, tenantId: number, id: string, days: number, projectId?: number | null): Promise<ToolResult | null> {
    const provider = TOOL_DATA_PROVIDERS[id];
    if (!provider) return null;
    return getOrSetCached(env, dataKey(tenantId, id, days, projectId), () => provider(this.db, tenantId, days, projectId ?? null), { kvTtlSeconds: 300 });
  }

  /**
   * Persist a run — recomputed server-side so the saved result is authoritative.
   * kind 'self' recomputes from `input` (answers/values); 'data' recomputes from
   * telemetry (input carries { days }). When `projectId` is set the run is scored
   * against that project and feeds its diagnostic rating.
   */
  async saveRun(env: Env, args: { tenantId: number; toolId: string; kind: 'self' | 'data'; input: Record<string, number>; projectId?: number | null; createdBy?: string | null }): Promise<SavedToolRun | null> {
    let result: ToolResult | null;
    if (args.kind === 'data') {
      const days = Math.min(Math.max(Number(args.input.days ?? 90), 7), 365);
      result = await this.getDataDriven(env, args.tenantId, args.toolId, days, args.projectId ?? null);
      args = { ...args, input: { days } };
    } else {
      result = this.compute(args.toolId, args.input);
    }
    if (!result) return null;
    return this.persist(env, { ...args, result });
  }

  /**
   * Record a pre-computed run produced outside the tool engine (e.g. the
   * architecture analysis derives its score from the design-principles artifact).
   * The result is trusted as-is — there is no compute/score fn for these ids.
   */
  async recordExternalRun(env: Env, args: { tenantId: number; toolId: string; projectId?: number | null; result: ToolResult; input?: Record<string, number>; createdBy?: string | null }): Promise<SavedToolRun> {
    return this.persist(env, { ...args, kind: 'data', input: args.input ?? {} });
  }

  private async persist(env: Env, args: { tenantId: number; toolId: string; kind: 'self' | 'data'; input: Record<string, number>; result: ToolResult; projectId?: number | null; createdBy?: string | null }): Promise<SavedToolRun> {
    const [row] = await this.db
      .insert(toolRuns)
      .values({
        tenantId: args.tenantId,
        toolId: args.toolId,
        kind: args.kind,
        projectId: args.projectId ?? null,
        input: args.input as object,
        result: args.result as object,
        createdBy: args.createdBy ?? null,
      })
      .returning();
    await Promise.all([
      invalidateCached(env, runsKey(args.tenantId, args.toolId, args.projectId ?? null)),
      args.projectId != null ? invalidateCached(env, projectScoreKey(args.tenantId, args.projectId)) : Promise.resolve(),
      args.projectId != null ? invalidateCached(env, rollupKey(args.tenantId)) : Promise.resolve(),
    ]);
    return this.rowToDto(row!);
  }

  /** Saved run history for a tool, cached + invalidated on save. Optionally
   *  scoped to a single project. */
  async listRuns(env: Env, tenantId: number, toolId: string, projectId?: number | null): Promise<SavedToolRun[]> {
    return getOrSetCached(env, runsKey(tenantId, toolId, projectId), async () => {
      const rows = await this.db
        .select()
        .from(toolRuns)
        .where(and(
          eq(toolRuns.tenantId, tenantId),
          eq(toolRuns.toolId, toolId),
          ...(projectId != null ? [eq(toolRuns.projectId, projectId)] : []),
        ))
        .orderBy(desc(toolRuns.createdAt))
        .limit(50);
      return rows.map((r) => this.rowToDto(r));
    }, { kvTtlSeconds: 300 });
  }

  /**
   * A project's diagnostic rating: the latest run of each diagnostic scored
   * against the project, plus an aggregate overall (mean of the per-diagnostic
   * scores). This is the "score/rating" a project earns from its diagnostics.
   */
  async getProjectScore(env: Env, tenantId: number, projectId: number): Promise<ProjectScore> {
    return getOrSetCached(env, projectScoreKey(tenantId, projectId), async () => {
      const rows = await this.db
        .select()
        .from(toolRuns)
        .where(and(eq(toolRuns.tenantId, tenantId), eq(toolRuns.projectId, projectId)))
        .orderBy(desc(toolRuns.createdAt))
        .limit(200);

      // Latest run per diagnostic (rows are newest-first).
      const latest = new Map<string, typeof toolRuns.$inferSelect>();
      for (const r of rows) if (!latest.has(r.toolId)) latest.set(r.toolId, r);

      // Join the project's tasks to derive each diagnostic's real remediation state.
      const projectTasks = (await this.remediationTasksByProject([projectId])).get(projectId) ?? [];

      const diagnostics: ProjectDiagnostic[] = [...latest.values()].map((r) => {
        const result = r.result as ToolResult;
        const name = diagnosticName(r.toolId);
        return {
          toolId: r.toolId,
          name,
          icon: diagnosticIcon(r.toolId),
          score: result.score ?? null,
          scoreLabel: result.scoreLabel ?? null,
          headline: result.headline ?? '',
          gapCount: result.recommendations?.length ?? 0,
          remediation: deriveRemediation(name, projectTasks),
          kind: r.kind,
          createdAt: r.createdAt.toISOString(),
          result,
        };
      });
      diagnostics.sort((a, b) => a.name.localeCompare(b.name));

      const overall = meanScore(diagnostics.map((d) => d.score));
      const result: ToolResult = {
        headline: overall != null ? `${levelName(overall)} — ${overall.toFixed(1)} / 5` : 'Not scored yet',
        summary: overall != null
          ? 'Average rating across the diagnostics run against this project.'
          : 'Run a diagnostic against this project to give it a rating.',
        score: overall,
        scoreLabel: overall != null ? levelName(overall) : null,
        metrics: diagnostics.map((d) => ({
          label: d.name,
          value: d.score != null ? `${d.score.toFixed(1)} — ${d.scoreLabel ?? levelName(d.score)}` : d.headline || 'Not scored',
          tier: d.score != null ? clampLevel(d.score) : undefined,
        })),
        recommendations: [],
      };
      return { result, diagnostics };
    }, { kvTtlSeconds: 300 });
  }

  /**
   * Tenant rollup: each project's diagnostic rating, plus an overall (mean of the
   * project ratings) — the project scores rolled up to the workspace.
   */
  async getTenantRollup(env: Env, tenantId: number): Promise<TenantDiagnosticsRollup> {
    return getOrSetCached(env, rollupKey(tenantId), async () => {
      const rows = await this.db
        .select({
          projectId: toolRuns.projectId,
          toolId: toolRuns.toolId,
          result: toolRuns.result,
          createdAt: toolRuns.createdAt,
        })
        .from(toolRuns)
        .where(and(eq(toolRuns.tenantId, tenantId), isNotNull(toolRuns.projectId)))
        .orderBy(desc(toolRuns.createdAt))
        .limit(2000);

      // For each project, keep the latest run per diagnostic.
      const byProject = new Map<number, { latest: Map<string, ToolResult>; lastRunAt: Date }>();
      for (const r of rows) {
        if (r.projectId == null) continue;
        let entry = byProject.get(r.projectId);
        if (!entry) { entry = { latest: new Map(), lastRunAt: r.createdAt }; byProject.set(r.projectId, entry); }
        if (!entry.latest.has(r.toolId)) entry.latest.set(r.toolId, r.result as ToolResult);
        if (r.createdAt > entry.lastRunAt) entry.lastRunAt = r.createdAt;
      }

      const projectIds = [...byProject.keys()];
      const names = projectIds.length
        ? await this.db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.tenantId, tenantId))
        : [];
      const nameById = new Map(names.map((p) => [p.id, p.name]));

      // One task read for the whole rollup → each diagnostic's remediation state.
      const tasksByProject = await this.remediationTasksByProject(projectIds);

      const projectScores: TenantProjectScore[] = projectIds.map((pid) => {
        const entry = byProject.get(pid)!;
        const projectTasks = tasksByProject.get(pid) ?? [];
        const score = meanScore([...entry.latest.values()].map((r) => r.score ?? null));
        const diagnostics: ProjectDiagnosticSummary[] = [...entry.latest.entries()]
          .map(([toolId, r]) => {
            const name = diagnosticName(toolId);
            return {
              toolId,
              name,
              icon: diagnosticIcon(toolId),
              score: r.score ?? null,
              scoreLabel: r.scoreLabel ?? null,
              gapCount: r.recommendations?.length ?? 0,
              remediation: deriveRemediation(name, projectTasks),
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name));
        return {
          projectId: pid,
          name: nameById.get(pid) ?? `#${pid}`,
          score,
          scoreLabel: score != null ? levelName(score) : null,
          diagnosticCount: entry.latest.size,
          lastRunAt: entry.lastRunAt.toISOString(),
          diagnostics,
        };
      });
      projectScores.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name));

      const overall = meanScore(projectScores.map((p) => p.score));
      const result: ToolResult = {
        headline: overall != null ? `${levelName(overall)} — ${overall.toFixed(1)} / 5` : 'No project diagnostics yet',
        summary: overall != null
          ? `Average diagnostic rating across ${projectScores.filter((p) => p.score != null).length} scored project(s).`
          : 'Run a diagnostic against a project to start scoring your workspace.',
        score: overall,
        scoreLabel: overall != null ? levelName(overall) : null,
        metrics: projectScores.map((p) => ({
          label: p.name,
          value: p.score != null ? `${p.score.toFixed(1)} — ${p.scoreLabel}` : 'Not scored',
          hint: `${p.diagnosticCount} diagnostic${p.diagnosticCount === 1 ? '' : 's'}`,
          tier: p.score != null ? clampLevel(p.score) : undefined,
        })),
        recommendations: [],
      };
      return { result, projects: projectScores };
    }, { kvTtlSeconds: 300 });
  }

  private rowToDto(row: typeof toolRuns.$inferSelect): SavedToolRun {
    return {
      id: row.id,
      toolId: row.toolId,
      kind: row.kind,
      projectId: row.projectId ?? null,
      input: (row.input ?? {}) as Record<string, number>,
      result: row.result as ToolResult,
      createdBy: row.createdBy ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
