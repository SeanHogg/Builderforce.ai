import { reportCaughtError } from '../observability/caughtErrorReporter';
import { and, eq, desc, isNotNull, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached, invalidateCached, projectScoreCacheKey, tenantRollupCacheKey } from '../../infrastructure/cache/readThroughCache';
import { toolRuns, projects, tasks } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { deriveRemediation, type RemediationSummary, type RemediationTaskRow } from './remediationStatus';
import { TOOLS, getTool } from './toolDefinitions';
import { TOOL_DATA_PROVIDERS, hasDataProvider } from './toolDataProviders';
import { toSummary, toDefinition, type ToolSummary, type ToolDefinition, type ToolResult } from './toolTypes';
import { applyMaturityFramework, maturityFramework, supportsMaturityFrameworks, type MaturityFrameworkId } from './maturityFrameworks';
import { localizeTool, toolCopy, DEFAULT_TOOL_LOCALE, type ToolLocale } from './toolMessages';
import { TOOL_LOCALES, resultCopy } from './resultCopy';
import { storedFigures, storedResult, withFigures } from './storedToolResult';
import { scoreQuestionnaire, scoreQuiz } from './toolTypes';

import { ARCHITECTURE_DIAGNOSTIC_ID, EXTERNAL_DIAGNOSTIC_NAMES, EXTERNAL_DIAGNOSTIC_ICONS } from './auditIds';

/** Re-exported so existing importers (e.g. AnalysisRunnerDO) keep their import
 *  path. The canonical definition lives in `auditIds.ts` alongside the other
 *  system-audit ids and their display names. */
export { ARCHITECTURE_DIAGNOSTIC_ID };

const clampLevel = (n: number): number => Math.max(1, Math.min(5, Math.round(n)));
/**
 * The five CMMI band names, from the SHARED chrome rather than a private list.
 *
 * This module carried its own copy of them, which meant the rollup could call a
 * 3.0 "Defined" while a scorer that had been re-worded called it something else —
 * two spellings of one band, on two surfaces, for the same number. English is
 * pinned here on purpose: the rollup is not yet locale-aware (its cache key has
 * no locale in it), so it must not silently render half a page in another
 * language. Widening it is a matter of threading the reader's locale through
 * `getProjectScore` / `getTenantRollup` and folding it into those keys.
 */
const levelName = (n: number): string => resultCopy(DEFAULT_TOOL_LOCALE).levelNames[clampLevel(n) - 1]!;

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

/**
 * Saved-run history, keyed BY LOCALE.
 *
 * The locale is in the key because the cached value is the RENDERED history: a
 * run is re-scored in the reader's language on read, so one cache entry cannot
 * serve two readers. A write invalidates every locale's entry
 * (see {@link ToolService.invalidateRuns}) — a partial invalidation would leave
 * a French reader looking at a history that is missing the run they just saved.
 */
const runsKey = (tenantId: number, toolId: string, projectId: number | null | undefined, locale: ToolLocale) =>
  `tools:runs:tenant:${tenantId}:${toolId}:project:${projectId ?? 'none'}:l:${locale}`;
/**
 * Collected telemetry FIGURES for one window — deliberately locale-free.
 *
 * `:v2` is a version token, not decoration. The same key held a rendered
 * `ToolResult` before the collect/score split, and a stale KV entry read back as
 * a figures payload would score as garbage; bumping the token orphans them
 * instead of requiring a KV sweep. The win is real: one aggregation now serves
 * all five languages rather than five.
 */
const dataKey = (tenantId: number, toolId: string, days: number, projectId?: number | null) =>
  `tools:data:v2:tenant:${tenantId}:${toolId}:days:${days}:project:${projectId ?? 'none'}`;
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
    } catch (error) {
      // Task read failed — diagnostics still score, remediation just shows 'none'.
    
      reportCaughtError(error, { source: "application/tools/ToolService.ts", operation: "remediationTasksByProject" });
    }
    return byProject;
  }

  /** Public — list every free tool (client-safe summaries + data-mode flag), in
   *  the caller's language. */
  list(locale: ToolLocale = DEFAULT_TOOL_LOCALE): ToolSummary[] {
    return TOOLS.map((tool) => {
      const t = localizeTool(tool, locale);
      return { ...toSummary(t), hasDataDriven: hasDataProvider(t.id), supportsMaturityFrameworks: supportsMaturityFrameworks(t) };
    });
  }

  /** Public — a tool's full definition (questions / inputs, no compute fn), in
   *  the caller's language. */
  getDefinition(id: string, locale: ToolLocale = DEFAULT_TOOL_LOCALE): ToolDefinition | null {
    const tool = getTool(id);
    if (!tool) return null;
    const localized = localizeTool(tool, locale);
    return { ...toDefinition(localized), hasDataDriven: hasDataProvider(id), supportsMaturityFrameworks: supportsMaturityFrameworks(localized) };
  }

  /**
   * Pure compute — runs the tool's scorer over the supplied input
   * (calculator values or questionnaire answers). No tenant data is read, so
   * this is safe to expose publicly for the free preview.
   *
   * `framework` re-lenses a maturity scorecard into COBIT / ITIL domains. It runs
   * over the SAME scored result, so a self-assessment and its telemetry twin can
   * never report different numbers under a lens.
   */
  compute(
    id: string,
    input: Record<string, number>,
    framework?: MaturityFrameworkId,
    locale: ToolLocale = DEFAULT_TOOL_LOCALE,
  ): ToolResult | null {
    const source = getTool(id);
    if (!source || source.kind === 'analyzer') return null;
    const tool = localizeTool(source, locale);
    // The shared scorers are called DIRECTLY rather than through `tool.score()`,
    // because that method closes over the registry's English `this`. Running them
    // over the localized tool is what makes a questionnaire's RESULT translated
    // — its section names and advancement actions come from the tool itself, so
    // there is no second catalog to keep in step with the first.
    const copy = resultCopy(locale);
    const result = tool.kind === 'calculator' ? tool.compute(input)
      : tool.kind === 'questionnaire' ? scoreQuestionnaire(tool, input, copy)
      : scoreQuiz(tool, input, copy);
    return applyMaturityFramework(result, maturityFramework(framework));
  }

  /**
   * Pure analysis — runs an analyzer over the supplied DOCUMENTS.
   *
   * Separate from {@link compute} because the input map is string-valued: an
   * analyzer reads prose the person wrote, where every other kind scores numbers
   * they picked from choices we wrote. Equally pure, so equally safe to expose
   * publicly for the free preview.
   */
  analyze(id: string, input: Record<string, string>, locale: ToolLocale = DEFAULT_TOOL_LOCALE): ToolResult | null {
    const tool = getTool(id);
    if (!tool || tool.kind !== 'analyzer') return null;
    // The FIELDS are localized by `getDefinition` like every other definition;
    // the findings are localized here, by handing `analyze()` the copy lookup for
    // this locale. Both halves come out of the same four catalogs, so a French
    // visitor can no longer get a translated résumé-scorer form with English
    // findings under it. `analyze` stays pure — the copy is a parameter.
    return tool.analyze(input, toolCopy(tool, locale));
  }

  /** Whether a tool has a telemetry-derived "from your data" mode. */
  hasDataDriven(id: string): boolean {
    return hasDataProvider(id);
  }

  /**
   * Data-driven result from this workspace's telemetry, cached. Null if no provider.
   * When projectId is set the result is scoped to that project.
   *
   * `framework` re-lenses the scorecard into COBIT / ITIL domains. It is applied
   * AFTER the cache read on purpose: the lens is a pure projection of one scored
   * result, so three framework views share one computation instead of tripling
   * the cache keyspace and the telemetry aggregation behind it.
   */
  async getDataDriven(env: Env, tenantId: number, id: string, days: number, projectId?: number | null, framework?: MaturityFrameworkId, locale: ToolLocale = DEFAULT_TOOL_LOCALE): Promise<ToolResult | null> {
    const figures = await this.dataFigures(env, tenantId, id, days, projectId);
    if (figures === undefined) return null;
    const result = this.scoreData(id, figures, locale);
    if (!result) return null;
    return applyMaturityFramework(result, maturityFramework(framework));
  }

  /**
   * The collected telemetry for one window, cached. `undefined` for a tool with
   * no provider — distinct from a provider that legitimately collected nothing.
   *
   * What is cached is the FIGURES, not the rendering, which is what lets the same
   * aggregation be rendered into five languages and lets a saved run be
   * re-rendered years later without touching the database.
   */
  private async dataFigures(env: Env, tenantId: number, id: string, days: number, projectId?: number | null): Promise<unknown | undefined> {
    const provider = TOOL_DATA_PROVIDERS[id];
    if (!provider) return undefined;
    return getOrSetCached(env, dataKey(tenantId, id, days, projectId), () => provider.collect(this.db, tenantId, days, projectId ?? null), { kvTtlSeconds: 300 });
  }

  /** Pure: figures → a result in one language. Null when the tool or its provider
   *  has since been removed, which is the caller's cue to fall back to whatever
   *  rendering the run already carries. */
  private scoreData(id: string, figures: unknown, locale: ToolLocale): ToolResult | null {
    const provider = TOOL_DATA_PROVIDERS[id];
    const source = getTool(id);
    if (!provider || !source) return null;
    const tool = localizeTool(source, locale);
    return provider.score(figures, { chrome: resultCopy(locale), copy: toolCopy(tool, locale), tool });
  }

  /**
   * Persist a run — recomputed server-side so the saved result is authoritative.
   * kind 'self' recomputes from `input` (answers/values); 'data' recomputes from
   * telemetry (input carries { days }). When `projectId` is set the run is scored
   * against that project and feeds its diagnostic rating.
   */
  async saveRun(env: Env, args: { tenantId: number; toolId: string; kind: 'self' | 'data'; input: Record<string, number>; projectId?: number | null; createdBy?: string | null }): Promise<SavedToolRun | null> {
    // ALWAYS rendered in the default locale, whatever language the saver is
    // reading in. The stored rendering is the FALLBACK a reader gets when the run
    // can no longer be re-rendered, so it has to be written in one predictable
    // language rather than in whichever one the manager happened to be using.
    if (args.kind === 'data') {
      const days = Math.min(Math.max(Number(args.input.days ?? 90), 7), 365);
      const figures = await this.dataFigures(env, args.tenantId, args.toolId, days, args.projectId ?? null);
      if (figures === undefined) return null;
      const result = this.scoreData(args.toolId, figures, DEFAULT_TOOL_LOCALE);
      if (!result) return null;
      // The figures ride along, so this snapshot can be re-rendered in the
      // reader's language later — the telemetry window it was taken over will
      // have passed, and re-querying would answer a different question.
      return this.persist(env, { ...args, input: { days }, result: withFigures(result, figures) });
    }
    const result = this.compute(args.toolId, args.input);
    if (!result) return null;
    // No figures needed: a self-assessment's `input` IS its figures, and it is
    // already stored in its own column, so `listRuns` re-scores from there.
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
      this.invalidateRuns(env, args.tenantId, args.toolId, args.projectId ?? null),
      args.projectId != null ? invalidateCached(env, projectScoreKey(args.tenantId, args.projectId)) : Promise.resolve(),
      args.projectId != null ? invalidateCached(env, rollupKey(args.tenantId)) : Promise.resolve(),
    ]);
    return this.rowToDto(row!, DEFAULT_TOOL_LOCALE);
  }

  /** Drop the saved history for EVERY language, not just the writer's. One
   *  invalidation per locale is the price of caching a rendered list; skipping
   *  the other four would hide a just-saved run from every other reader until the
   *  TTL expired. */
  private async invalidateRuns(env: Env, tenantId: number, toolId: string, projectId: number | null): Promise<void> {
    await Promise.all(TOOL_LOCALES.map((locale) => invalidateCached(env, runsKey(tenantId, toolId, projectId, locale))));
  }

  /**
   * Saved run history for a tool, IN THE READER'S LANGUAGE, cached + invalidated
   * on save. Optionally scoped to a single project.
   *
   * A stored result is JSON, so a run saved by a German manager used to read as
   * German to an English teammate looking at the same workspace history — and
   * storing five renderings would be five times the row and still wrong the day a
   * sixth locale ships. Instead each row is re-rendered on read: see
   * {@link ToolService.renderRun} for how, and why the default locale short-
   * circuits back to the stored snapshot untouched.
   *
   * The read goes through the canonical read-through cache, keyed WITH the locale,
   * so the recompute is paid once per language per window rather than per view.
   */
  async listRuns(env: Env, tenantId: number, toolId: string, projectId?: number | null, locale: ToolLocale = DEFAULT_TOOL_LOCALE): Promise<SavedToolRun[]> {
    return getOrSetCached(env, runsKey(tenantId, toolId, projectId, locale), async () => {
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
      return rows.map((r) => this.rowToDto(r, locale));
    }, { kvTtlSeconds: 300 });
  }

  /**
   * One saved run's result, in the reader's language.
   *
   * Two paths, plus one fallback that every path ends at:
   *
   *   - `self` re-scores from the stored `input`, which is sufficient on its own.
   *   - `data` re-renders from the stored FIGURES; its telemetry window has
   *     passed, so there is nothing else it could be scored from, and re-querying
   *     today would quietly answer a different question.
   *   - anything that cannot be re-rendered falls back to the stored rendering.
   *     A row written before the envelope existed, a tool since deleted, a
   *     payload whose shape moved on — all of them render, none of them throw.
   *
   * The re-render runs for EVERY locale, including the default, deliberately.
   * Short-circuiting English would assume the stored rendering is English, and
   * that is precisely the assumption this whole change exists to stop making: a
   * row written by the old path carries whatever language its saver was reading
   * in, and an English teammate has to be able to read it.
   *
   * The honest cost: a `self` run re-scored today is scored against TODAY's
   * questionnaire, so an edited recommendation changes what an old snapshot says.
   * That is the right trade — the alternative is a history in a language its
   * reader does not have — and it does not apply to `data` runs at all, whose
   * figures are frozen at the moment they were taken.
   */
  private renderRun(row: typeof toolRuns.$inferSelect, locale: ToolLocale): ToolResult {
    const stored = storedResult(row.result);
    if (row.kind === 'data') {
      const figures = storedFigures(row.result);
      return (figures === undefined ? null : this.scoreData(row.toolId, figures, locale)) ?? stored;
    }
    return this.compute(row.toolId, (row.input ?? {}) as Record<string, number>, undefined, locale) ?? stored;
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
        // Through the envelope decoder, not a bare cast: a `data` run now carries
        // its figures beside its rendering, and the two extra properties must not
        // reach a caller that thinks it is holding a plain result.
        const result = storedResult(r.result);
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
        if (!entry.latest.has(r.toolId)) entry.latest.set(r.toolId, storedResult(r.result));
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

  private rowToDto(row: typeof toolRuns.$inferSelect, locale: ToolLocale): SavedToolRun {
    return {
      id: row.id,
      toolId: row.toolId,
      kind: row.kind,
      projectId: row.projectId ?? null,
      input: (row.input ?? {}) as Record<string, number>,
      result: this.renderRun(row, locale),
      createdBy: row.createdBy ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
