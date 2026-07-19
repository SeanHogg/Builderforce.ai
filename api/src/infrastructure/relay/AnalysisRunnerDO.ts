/**
 * AnalysisRunnerDO — drives a Digital-Transformation / Architect repo analysis
 * across Durable Object alarm() ticks. Each tick is a fresh Worker invocation
 * with a fresh subrequest budget, so the full job (fetch repos → 6 LLM calls →
 * write-back) never exceeds the per-invocation subrequest / CPU caps.
 *
 * Hard rule: ONE repo OR ONE LLM artifact per tick. The DO-local cursor
 * (state.storage) is the idempotency anchor; the repo_analysis_runs row mirrors
 * status/stage/progress for the polling UI. All Postgres writes upsert on the
 * unique (run_id, …) constraints so a retried tick never duplicates rows.
 *
 * Kickoff: the route POSTs `https://do/start`; the DO writes the cursor and
 * arms the first alarm. No long work happens in fetch().
 */
import { and, eq } from 'drizzle-orm';
import { buildDatabase, type Db } from '../database/connection';
import {
  integrationCredentials,
  projectMemories,
  projectRepositories,
  projects,
  repoAnalysisArtifacts,
  repoAnalysisEvidence,
  repoAnalysisRuns,
  llmUsageLog,
  specs,
  tasks,
  executions,
} from '../database/schema';
import { decryptCredentials } from '../../application/boardsync/drizzleStore';
import { WorkerSubrequestExhaustedError } from '../../application/llm/vendors/types';
import {
  createRepoSource,
  makeRepoFetch,
  selectEvidence,
} from '../../application/repos/sources/RepoSource';
import { ArchitectAnalysisService, ArtifactGenerationError } from '../../application/repoanalysis/ArchitectAnalysisService';
import { ToolService, ARCHITECTURE_DIAGNOSTIC_ID } from '../../application/tools/ToolService';
import { deriveArchitectureResult } from '../../application/tools/auditScanners';
import { linkSpecToTask } from '../../application/prd/taskPrd';
import {
  ARTIFACT_KINDS,
  FREE_ARTIFACT_KINDS,
  type ArtifactKind,
  type EvidenceBundle,
  type GeneratedArtifact,
  type RepoEvidence,
} from '../../application/repoanalysis/types';
import type { Env } from '../../env';

interface StartBody {
  runId: string;
  projectId: number;
  tenantId: number;
  segmentId?: string | null;
  effectivePlan: string;
  triggeredBy?: string | null;
  projectName: string;
  repoIds: string[];
  /** The board Task this run is surfaced as, and its runtime execution row. */
  taskId?: number | null;
  executionId?: number | null;
}

type Stage = 'fetching' | 'analyzing' | 'writing_back' | 'done';

interface Cursor {
  runId: string;
  projectId: number;
  tenantId: number;
  segmentId: string | null;
  effectivePlan: string;
  triggeredBy: string | null;
  projectName: string;
  taskId: number | null;
  executionId: number | null;
  stage: Stage;
  repoQueue: string[];
  repoCursor: number;
  repoAttempts: number;
  artifactQueue: ArtifactKind[];
  artifactCursor: number;
  tokenBudget: number;
  tokensUsed: number;
  anyArtifactFailed: boolean;
}

interface PlanConfig {
  tokenBudget: number;
  artifactKinds: ArtifactKind[];
  maxFilesPerRepo: number;
  evidenceTokensPerRepo: number;
}

function planConfig(plan: string): PlanConfig {
  const paid = plan === 'pro' || plan === 'teams';
  return {
    tokenBudget: paid ? 120_000 : 9_000,
    artifactKinds: paid ? [...ARTIFACT_KINDS] : [...FREE_ARTIFACT_KINDS],
    maxFilesPerRepo: paid ? 25 : 8,
    evidenceTokensPerRepo: paid ? 6_000 : 2_500,
  };
}

const FILE_CONTENT_CAP = 8 * 1024; // chars per sampled file sent to the LLM
const CURSOR_KEY = 'cursor';

export class AnalysisRunnerDO implements DurableObject {
  declare readonly '__DURABLE_OBJECT_BRAND': never;

  private readonly db: Db;
  constructor(private readonly state: DurableObjectState, private readonly env: Env) {
    this.db = buildDatabase(env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname.endsWith('/start')) {
      const body = (await request.json().catch(() => null)) as StartBody | null;
      if (!body?.runId) return new Response('bad request', { status: 400 });
      await this.start(body);
      return new Response(JSON.stringify({ ok: true }), { status: 202, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  }

  private async start(body: StartBody): Promise<void> {
    const cfg = planConfig(body.effectivePlan);
    const cursor: Cursor = {
      runId: body.runId,
      projectId: body.projectId,
      tenantId: body.tenantId,
      segmentId: body.segmentId ?? null,
      effectivePlan: body.effectivePlan,
      triggeredBy: body.triggeredBy ?? null,
      projectName: body.projectName,
      taskId: body.taskId ?? null,
      executionId: body.executionId ?? null,
      stage: 'fetching',
      repoQueue: body.repoIds,
      repoCursor: 0,
      repoAttempts: 0,
      artifactQueue: cfg.artifactKinds,
      artifactCursor: 0,
      tokenBudget: cfg.tokenBudget,
      tokensUsed: 0,
      anyArtifactFailed: false,
    };
    await this.state.storage.put(CURSOR_KEY, cursor);
    await this.db
      .update(repoAnalysisRuns)
      .set({ status: 'fetching', stage: 'fetching', progress: 1, startedAt: new Date(), updatedAt: new Date() })
      .where(eq(repoAnalysisRuns.id, body.runId));
    await this.state.storage.setAlarm(Date.now());
  }

  async alarm(): Promise<void> {
    const cursor = (await this.state.storage.get<Cursor>(CURSOR_KEY)) ?? null;
    if (!cursor) return;
    try {
      switch (cursor.stage) {
        case 'fetching':     await this.tickFetching(cursor); break;
        case 'analyzing':    await this.tickAnalyzing(cursor); break;
        case 'writing_back': await this.tickWritingBack(cursor); break;
        case 'done':         await this.tickDone(cursor); break;
      }
    } catch (err) {
      if (err instanceof WorkerSubrequestExhaustedError && cursor.stage === 'fetching') {
        // Don't advance — retry the same repo on a fresh isolate/budget.
        cursor.repoAttempts += 1;
        if (cursor.repoAttempts < 3) {
          await this.state.storage.put(CURSOR_KEY, cursor);
          await this.state.storage.setAlarm(Date.now() + 2000);
          return;
        }
        // Give up on this repo: record a partial (empty) evidence row, advance.
        await this.recordPartialEvidence(cursor, cursor.repoQueue[cursor.repoCursor]);
        cursor.repoCursor += 1;
        cursor.repoAttempts = 0;
        await this.persistAndArm(cursor);
        return;
      }
      // Unexpected failure — fail the run.
      await this.failRun(cursor, err instanceof Error ? err.message : String(err));
    }
  }

  // ── stage: fetching ──────────────────────────────────────────────────────

  private async tickFetching(cursor: Cursor): Promise<void> {
    if (cursor.repoCursor >= cursor.repoQueue.length) {
      cursor.stage = 'analyzing';
      await this.updateRun(cursor, { status: 'analyzing', stage: 'analyzing' });
      await this.persistAndArm(cursor);
      return;
    }
    const repoId = cursor.repoQueue[cursor.repoCursor];
    if (repoId) await this.fetchRepoEvidence(cursor, repoId);
    cursor.repoCursor += 1;
    cursor.repoAttempts = 0;
    await this.updateRun(cursor, { stage: `fetching ${cursor.repoCursor}/${cursor.repoQueue.length}` });
    await this.persistAndArm(cursor);
  }

  private async fetchRepoEvidence(cursor: Cursor, repoId: string): Promise<void> {
    const [repo] = await this.db
      .select()
      .from(projectRepositories)
      .where(and(eq(projectRepositories.id, repoId), eq(projectRepositories.tenantId, cursor.tenantId)));
    if (!repo) {
      await this.recordPartialEvidence(cursor, repoId);
      return;
    }

    const { token, username } = await this.resolveCredential(cursor.tenantId, repo.credentialId);
    const cfg = planConfig(cursor.effectivePlan);
    const fetchFn = makeRepoFetch();

    try {
      const source = createRepoSource(
        repo.provider,
        { owner: repo.owner, repo: repo.repo, host: repo.host, token, username },
        fetchFn,
      );
      const branch = repo.defaultBranch || (await source.getDefaultBranch());
      const [languages, tree] = await Promise.all([
        source.getLanguages().catch(() => ({})),
        source.getTree(branch),
      ]);

      const picks = selectEvidence(tree.entries, {
        maxFiles: cfg.maxFilesPerRepo,
        maxTokens: cfg.evidenceTokensPerRepo,
      });
      const sampledFiles: RepoEvidence['sampledFiles'] = [];
      for (const p of picks) {
        const content = await source.getFileContent(p.path, branch);
        if (content == null) continue;
        const truncated = content.length > FILE_CONTENT_CAP;
        sampledFiles.push({ path: p.path, content: truncated ? content.slice(0, FILE_CONTENT_CAP) : content, truncated });
      }
      const recentCommits = await source.listCommits(branch, 12).catch(() => []);

      const fileEntries = tree.entries.filter((e) => e.type === 'file');
      const topDirs = uniqueTopDirs(tree.entries);
      const totalBytes = fileEntries.reduce((n, e) => n + (e.bytes ?? 0), 0);

      await this.upsertEvidence(cursor, repoId, {
        provider: repo.provider,
        defaultBranch: branch,
        languages: JSON.stringify(languages),
        treeSummary: JSON.stringify({ topDirs, fileCount: fileEntries.length, totalBytes, truncated: tree.truncated }),
        sampledFiles: JSON.stringify(sampledFiles),
        commitSummary: JSON.stringify({ recent: recentCommits.map((c) => ({ message: c.message, date: c.date })) }),
        tokenEstimate: sampledFiles.reduce((n, f) => n + Math.ceil(f.content.length / 4), 0),
        status: sampledFiles.length > 0 ? 'complete' : 'partial',
      });
    } catch (err) {
      if (err instanceof WorkerSubrequestExhaustedError) throw err; // handled by alarm() backoff
      await this.recordPartialEvidence(cursor, repoId);
    }
  }

  private async resolveCredential(
    tenantId: number,
    credentialId: string | null,
  ): Promise<{ token: string; username: string | null }> {
    if (!credentialId) return { token: '', username: null };
    const [row] = await this.db
      .select()
      .from(integrationCredentials)
      .where(and(eq(integrationCredentials.id, credentialId), eq(integrationCredentials.tenantId, tenantId)));
    if (!row) return { token: '', username: null };
    const secret = this.env.INTEGRATION_ENCRYPTION_SECRET ?? this.env.JWT_SECRET ?? '';
    const creds = await decryptCredentials(row.credentialsEnc, row.iv, secret, tenantId);
    const token = String(creds?.accessToken ?? creds?.apiToken ?? creds?.token ?? '');
    const username = creds?.username ? String(creds.username) : creds?.email ? String(creds.email) : null;
    return { token, username };
  }

  // ── stage: analyzing ─────────────────────────────────────────────────────

  private async tickAnalyzing(cursor: Cursor): Promise<void> {
    if (cursor.artifactCursor >= cursor.artifactQueue.length) {
      cursor.stage = 'writing_back';
      await this.updateRun(cursor, { status: 'writing_back', stage: 'writing_back' });
      await this.persistAndArm(cursor);
      return;
    }
    // Token-budget gate: skip the rest if we're out of budget.
    if (cursor.tokensUsed >= cursor.tokenBudget) {
      cursor.artifactCursor = cursor.artifactQueue.length;
      cursor.stage = 'writing_back';
      await this.persistAndArm(cursor);
      return;
    }

    const kind = cursor.artifactQueue[cursor.artifactCursor];
    if (!kind) {
      cursor.artifactCursor += 1;
      await this.persistAndArm(cursor);
      return;
    }
    const bundle = await this.loadEvidenceBundle(cursor);
    const priors = await this.loadPriorArtifacts(cursor.runId);
    const svc = new ArchitectAnalysisService(this.env);

    try {
      const art = await svc.generate(kind, bundle, priors);
      await this.upsertArtifact(cursor, art, 'complete');
      cursor.tokensUsed += art.tokens;
      await this.meterUsage(cursor, art);
      if (kind === 'recommendation' && art.recommendation) {
        await this.updateRun(cursor, { recommendation: art.recommendation });
      }
    } catch (err) {
      cursor.anyArtifactFailed = true;
      const message = err instanceof ArtifactGenerationError ? err.message : String(err);
      await this.upsertFailedArtifact(cursor, kind, message);
    }

    cursor.artifactCursor += 1;
    await this.updateRun(cursor, { tokensUsed: cursor.tokensUsed, stage: `analyzing ${cursor.artifactCursor}/${cursor.artifactQueue.length}` });
    await this.persistAndArm(cursor);
  }

  private async loadEvidenceBundle(cursor: Cursor): Promise<EvidenceBundle> {
    const rows = await this.db
      .select({
        provider: repoAnalysisEvidence.provider,
        defaultBranch: repoAnalysisEvidence.defaultBranch,
        languages: repoAnalysisEvidence.languages,
        treeSummary: repoAnalysisEvidence.treeSummary,
        sampledFiles: repoAnalysisEvidence.sampledFiles,
        commitSummary: repoAnalysisEvidence.commitSummary,
        owner: projectRepositories.owner,
        repo: projectRepositories.repo,
      })
      .from(repoAnalysisEvidence)
      .innerJoin(projectRepositories, eq(projectRepositories.id, repoAnalysisEvidence.repoId))
      .where(eq(repoAnalysisEvidence.runId, cursor.runId));

    const repos: RepoEvidence[] = rows.map((r) => {
      const tree = safeJson<RepoEvidence['treeSummary']>(r.treeSummary) ?? { topDirs: [], fileCount: 0, totalBytes: 0, truncated: false };
      const commit = safeJson<{ recent?: { message: string; date: string }[] }>(r.commitSummary) ?? {};
      return {
        provider: r.provider ?? 'github',
        owner: r.owner,
        repo: r.repo,
        defaultBranch: r.defaultBranch ?? 'main',
        languages: safeJson<Record<string, number>>(r.languages) ?? {},
        treeSummary: tree,
        sampledFiles: safeJson<RepoEvidence['sampledFiles']>(r.sampledFiles) ?? [],
        recentCommits: commit.recent ?? [],
      };
    });
    return { projectName: cursor.projectName, repos };
  }

  private async loadPriorArtifacts(runId: string): Promise<Partial<Record<ArtifactKind, GeneratedArtifact>>> {
    const rows = await this.db
      .select({ kind: repoAnalysisArtifacts.kind, dataJson: repoAnalysisArtifacts.dataJson, status: repoAnalysisArtifacts.status })
      .from(repoAnalysisArtifacts)
      .where(eq(repoAnalysisArtifacts.runId, runId));
    const out: Partial<Record<ArtifactKind, GeneratedArtifact>> = {};
    for (const r of rows) {
      if (r.status !== 'complete') continue;
      out[r.kind as ArtifactKind] = {
        kind: r.kind as ArtifactKind,
        title: '',
        bodyMd: '',
        dataJson: r.dataJson ?? '{}',
        model: null,
        tokens: 0,
      };
    }
    return out;
  }

  // ── stage: writing_back ──────────────────────────────────────────────────

  private async tickWritingBack(cursor: Cursor): Promise<void> {
    const priors = await this.loadPriorArtifacts(cursor.runId);
    const diagnostic = priors.diagnostic ? safeJson<Record<string, unknown>>(priors.diagnostic.dataJson) : null;
    const recommendation = priors.recommendation ? safeJson<Record<string, unknown>>(priors.recommendation.dataJson) : null;

    // 1) Write the diagnostic summary back to the project details.
    if (diagnostic) {
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (typeof diagnostic.suggestedProjectDescription === 'string' && diagnostic.suggestedProjectDescription.trim()) {
        set.description = diagnostic.suggestedProjectDescription.slice(0, 2000);
      }
      if (typeof diagnostic.suggestedModality === 'string' && VALID_MODALITY.has(diagnostic.suggestedModality)) {
        set.modality = diagnostic.suggestedModality;
      }
      if (Object.keys(set).length > 1) {
        await this.db
          .update(projects)
          .set(set)
          .where(and(eq(projects.id, cursor.projectId), eq(projects.tenantId, cursor.tenantId)));
      }
    }

    // 2) Seed the Brain: consolidated project memory so future chats/agents have context.
    const summaryParts: string[] = [];
    if (diagnostic?.summary) summaryParts.push(`What it does: ${String(diagnostic.summary)}`);
    if (recommendation?.recommendation) {
      summaryParts.push(`Modernization recommendation: ${String(recommendation.recommendation)} — ${String(recommendation.rationale ?? '')}`);
    }
    if (summaryParts.length > 0) {
      const consolidated = summaryParts.join('\n\n').slice(0, 8000);
      await this.db
        .insert(projectMemories)
        .values({
          tenantId: cursor.tenantId,
          segmentId: cursor.segmentId ?? undefined,
          projectId: cursor.projectId,
          consolidatedSummary: consolidated,
        })
        .onConflictDoUpdate({
          target: projectMemories.projectId,
          set: { consolidatedSummary: consolidated, updatedAt: new Date() },
        });
    }

    // 3) Record skipped placeholders for kinds excluded by the plan (Free upsell).
    const generated = new Set(Object.keys(priors));
    const failedRows = await this.db
      .select({ kind: repoAnalysisArtifacts.kind })
      .from(repoAnalysisArtifacts)
      .where(eq(repoAnalysisArtifacts.runId, cursor.runId));
    for (const r of failedRows) generated.add(r.kind);
    for (const kind of ARTIFACT_KINDS) {
      if (generated.has(kind)) continue;
      await this.upsertArtifact(
        cursor,
        {
          kind,
          title: ARTIFACT_TITLES[kind],
          bodyMd: `_This analysis is available on the Pro plan. Upgrade to unlock the full architecture report._`,
          dataJson: '{}',
          model: null,
          tokens: 0,
        },
        'skipped',
      );
    }

    // 4) Consolidate the generated artifacts into a single PRD and write it back
    //    as the project's architecture spec — this is how the analysis result is
    //    shared ("all knowledge is shared through PRDs"). One arch PRD per project.
    await this.writeArchitecturePrd(cursor);

    cursor.stage = 'done';
    await this.persistAndArm(cursor);
  }

  /** Build one markdown PRD from the complete artifacts and upsert it as the
   *  project's architecture spec, linking it to the Architect task. */
  private async writeArchitecturePrd(cursor: Cursor): Promise<void> {
    const rows = await this.db
      .select({ kind: repoAnalysisArtifacts.kind, title: repoAnalysisArtifacts.title, bodyMd: repoAnalysisArtifacts.bodyMd })
      .from(repoAnalysisArtifacts)
      .where(and(eq(repoAnalysisArtifacts.runId, cursor.runId), eq(repoAnalysisArtifacts.status, 'complete')));
    if (rows.length === 0) return; // nothing usable to publish

    rows.sort((a, b) => ARTIFACT_KINDS.indexOf(a.kind as ArtifactKind) - ARTIFACT_KINDS.indexOf(b.kind as ArtifactKind));
    const sections = rows
      .map((r) => `## ${r.title || ARTIFACT_TITLES[r.kind as ArtifactKind] || r.kind}\n\n${(r.bodyMd ?? '').trim()}`)
      .join('\n\n');
    const prd = `# Architecture Analysis — ${cursor.projectName}\n\n_Generated by the Architect agent from a repository analysis._\n\n${sections}`;
    const goal = `Architecture Analysis — ${cursor.projectName}`;
    const now = new Date();

    // One arch PRD per project: update the existing one if present, else insert.
    const [existing] = await this.db
      .select({ id: specs.id })
      .from(specs)
      .where(and(eq(specs.tenantId, cursor.tenantId), eq(specs.projectId, cursor.projectId), eq(specs.kind, 'architecture')))
      .limit(1);

    let specId: string;
    if (existing) {
      specId = existing.id;
      await this.db.update(specs).set({ goal, prd, status: 'ready', updatedAt: now }).where(eq(specs.id, specId));
    } else {
      specId = crypto.randomUUID();
      await this.db.insert(specs).values({
        id: specId,
        tenantId: cursor.tenantId,
        segmentId: cursor.segmentId ?? undefined,
        projectId: cursor.projectId,
        goal,
        kind: 'architecture',
        status: 'ready',
        prd,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (cursor.taskId != null) {
      await linkSpecToTask(this.db, { taskId: cursor.taskId, specId, tenantId: cursor.tenantId, isPrimary: true });
    }
  }

  // ── stage: done ──────────────────────────────────────────────────────────

  private async tickDone(cursor: Cursor): Promise<void> {
    const rows = await this.db
      .select({ kind: repoAnalysisArtifacts.kind, status: repoAnalysisArtifacts.status })
      .from(repoAnalysisArtifacts)
      .where(eq(repoAnalysisArtifacts.runId, cursor.runId));
    const diagnosticOk = rows.some((r) => r.kind === 'diagnostic' && r.status === 'complete');
    const anyFailed = rows.some((r) => r.status === 'failed') || cursor.anyArtifactFailed;
    const status = !diagnosticOk ? 'failed' : anyFailed ? 'partial' : 'completed';
    await this.db
      .update(repoAnalysisRuns)
      .set({ status, stage: 'done', progress: 100, finishedAt: new Date(), updatedAt: new Date() })
      .where(eq(repoAnalysisRuns.id, cursor.runId));

    // Close out the board Task + its execution row so the lane/agent-chip reflect
    // the terminal state. A genuine failure (no diagnostic) drops the task back to
    // To Do so it can be retried; otherwise it lands in Done.
    const ok = status !== 'failed';
    await this.closeTaskAndExecution(cursor, ok ? 'completed' : 'failed', ok ? 'done' : 'todo');

    // Record the run as a tracked project diagnostic so it contributes to the
    // project's rating (which rolls up to the tenant). Best-effort — a scoring
    // failure must not fail the analysis run.
    if (ok) await this.recordArchitectureDiagnostic(cursor).catch(() => {});

    await this.state.storage.delete(CURSOR_KEY);
    await this.state.storage.deleteAlarm();
  }

  /**
   * Derive a 1–5 diagnostic score from the design-principles artifact (DRY,
   * SOLID, DDD, Patterns each 0–10 → averaged → halved) and record it as a
   * project-scoped tool_run under the architecture-analysis diagnostic id. This
   * is what makes the Architect a tracked project diagnostic.
   */
  private async recordArchitectureDiagnostic(cursor: Cursor): Promise<void> {
    const [row] = await this.db
      .select({ dataJson: repoAnalysisArtifacts.dataJson })
      .from(repoAnalysisArtifacts)
      .where(and(
        eq(repoAnalysisArtifacts.runId, cursor.runId),
        eq(repoAnalysisArtifacts.kind, 'principles'),
        eq(repoAnalysisArtifacts.status, 'complete'),
      ))
      .limit(1);
    if (!row) return;
    const data = safeJson<Record<string, { score?: number; notes?: string }>>(row.dataJson ?? '{}');
    if (!data) return;

    // Shared 1–5 derivation (the same scorer the deterministic architecture audit
    // uses) — one source of truth for the principle→score math.
    const result = deriveArchitectureResult([
      { key: 'dry', label: 'DRY', score: data.dry?.score, notes: data.dry?.notes },
      { key: 'solid', label: 'SOLID', score: data.solid?.score, notes: data.solid?.notes },
      { key: 'ddd', label: 'DDD', score: data.ddd?.score, notes: data.ddd?.notes },
      { key: 'patterns', label: 'Patterns', score: data.patterns?.score, notes: data.patterns?.notes },
    ]);
    if (!result) return;

    await new ToolService(this.db).recordExternalRun(this.env, {
      tenantId: cursor.tenantId,
      projectId: cursor.projectId,
      toolId: ARCHITECTURE_DIAGNOSTIC_ID,
      result,
      createdBy: cursor.triggeredBy ?? null,
    });
  }

  /** Mark the linked execution row terminal and move the task to its final lane. */
  private async closeTaskAndExecution(cursor: Cursor, execStatus: 'completed' | 'failed', taskStatus: string): Promise<void> {
    const now = new Date();
    if (cursor.executionId != null) {
      await this.db
        .update(executions)
        .set({ status: execStatus, completedAt: now, updatedAt: now })
        .where(eq(executions.id, cursor.executionId))
        .catch(() => {});
    }
    if (cursor.taskId != null) {
      await this.db
        .update(tasks)
        .set({ status: taskStatus, updatedAt: now })
        .where(eq(tasks.id, cursor.taskId))
        .catch(() => {});
    }
  }

  // ── persistence helpers ──────────────────────────────────────────────────

  private async persistAndArm(cursor: Cursor): Promise<void> {
    await this.state.storage.put(CURSOR_KEY, cursor);
    await this.state.storage.setAlarm(Date.now());
  }

  /** Progress derived from the cursor: fetch 1–30, analyze 30–90, writeback 95, done 100. */
  private progressFor(cursor: Cursor): number {
    if (cursor.stage === 'fetching') {
      const frac = cursor.repoQueue.length ? cursor.repoCursor / cursor.repoQueue.length : 1;
      return Math.min(30, 1 + Math.round(frac * 29));
    }
    if (cursor.stage === 'analyzing') {
      const frac = cursor.artifactQueue.length ? cursor.artifactCursor / cursor.artifactQueue.length : 1;
      return 30 + Math.round(frac * 60);
    }
    if (cursor.stage === 'writing_back') return 95;
    return 100;
  }

  private async updateRun(cursor: Cursor, set: Partial<{ status: string; stage: string; recommendation: string; tokensUsed: number }>): Promise<void> {
    await this.db
      .update(repoAnalysisRuns)
      .set({ ...set, progress: this.progressFor(cursor), updatedAt: new Date() })
      .where(eq(repoAnalysisRuns.id, cursor.runId));
  }

  private async upsertEvidence(
    cursor: Cursor,
    repoId: string,
    fields: {
      provider: string; defaultBranch: string; languages: string; treeSummary: string;
      sampledFiles: string; commitSummary: string; tokenEstimate: number; status: string;
    },
  ): Promise<void> {
    await this.db
      .insert(repoAnalysisEvidence)
      .values({
        tenantId: cursor.tenantId,
        segmentId: cursor.segmentId ?? undefined,
        runId: cursor.runId,
        repoId,
        ...fields,
      })
      .onConflictDoUpdate({
        target: [repoAnalysisEvidence.runId, repoAnalysisEvidence.repoId],
        set: fields,
      });
  }

  private async recordPartialEvidence(cursor: Cursor, repoId: string | undefined): Promise<void> {
    if (!repoId) return;
    const [repo] = await this.db
      .select({ provider: projectRepositories.provider })
      .from(projectRepositories)
      .where(eq(projectRepositories.id, repoId));
    await this.upsertEvidence(cursor, repoId, {
      provider: repo?.provider ?? 'github',
      defaultBranch: '',
      languages: '{}',
      treeSummary: JSON.stringify({ topDirs: [], fileCount: 0, totalBytes: 0, truncated: false }),
      sampledFiles: '[]',
      commitSummary: '{}',
      tokenEstimate: 0,
      status: 'partial',
    });
  }

  private async upsertArtifact(cursor: Cursor, art: GeneratedArtifact, status: string): Promise<void> {
    await this.db
      .insert(repoAnalysisArtifacts)
      .values({
        tenantId: cursor.tenantId,
        segmentId: cursor.segmentId ?? undefined,
        runId: cursor.runId,
        projectId: cursor.projectId,
        kind: art.kind,
        title: art.title,
        bodyMd: art.bodyMd,
        dataJson: art.dataJson,
        model: art.model,
        tokens: art.tokens,
        status,
      })
      .onConflictDoUpdate({
        target: [repoAnalysisArtifacts.runId, repoAnalysisArtifacts.kind],
        set: { title: art.title, bodyMd: art.bodyMd, dataJson: art.dataJson, model: art.model, tokens: art.tokens, status, updatedAt: new Date() },
      });
  }

  private async upsertFailedArtifact(cursor: Cursor, kind: ArtifactKind, message: string): Promise<void> {
    await this.upsertArtifact(
      cursor,
      {
        kind,
        title: ARTIFACT_TITLES[kind],
        bodyMd: `_This section could not be generated: ${message}_`,
        dataJson: JSON.stringify({ error: message }),
        model: null,
        tokens: 0,
      },
      'failed',
    );
  }

  private async meterUsage(cursor: Cursor, art: GeneratedArtifact): Promise<void> {
    if (!art.tokens || !art.model) return;
    await this.db
      .insert(llmUsageLog)
      .values({
        tenantId: cursor.tenantId,
        userId: cursor.triggeredBy ?? null,
        llmProduct: 'builderforceLLM',
        model: art.model,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: art.tokens,
        useCase: `repo_analysis_${art.kind}`,
      })
      .catch(() => {});
  }

  private async failRun(cursor: Cursor, message: string): Promise<void> {
    await this.db
      .update(repoAnalysisRuns)
      .set({ status: 'failed', error: message.slice(0, 2000), finishedAt: new Date(), updatedAt: new Date() })
      .where(eq(repoAnalysisRuns.id, cursor.runId));
    await this.closeTaskAndExecution(cursor, 'failed', 'todo');
    await this.state.storage.delete(CURSOR_KEY);
    await this.state.storage.deleteAlarm();
  }
}

// ── module helpers ───────────────────────────────────────────────────────────

const VALID_MODALITY = new Set(['designer', 'architect', 'developer']);

const ARTIFACT_TITLES: Record<ArtifactKind, string> = {
  diagnostic: 'Repository Diagnostic',
  recommendation: 'Modernization Recommendation',
  business: 'Business Summary',
  arch_4plus1: '4+1 Architecture Views',
  antipatterns: 'Anti-Patterns Report',
  principles: 'Design Principles Assessment',
};

function uniqueTopDirs(entries: { path: string; type: 'file' | 'dir' }[]): string[] {
  const dirs = new Set<string>();
  for (const e of entries) {
    const seg = e.path.split('/')[0];
    if (seg && (e.type === 'dir' || e.path.includes('/'))) dirs.add(seg);
  }
  return [...dirs].sort().slice(0, 20);
}

function safeJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
