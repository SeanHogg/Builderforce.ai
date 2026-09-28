/**
 * The Evermind console's REST adapter — ONE implementation of the gateway calls behind
 * {@link EvermindConsoleAdapter}, for every host that talks to `/api/projects/:id/evermind/*`
 * with an authenticated `request` (the VS Code sidebar's bearer fetch, Synapse's signed-in
 * session). Before this, the VS Code webview held the only copy inline, and a second host
 * would have had to restate every path, method and response unwrap beside it.
 *
 * What genuinely differs per host is injected: how an authenticated call is made, and the
 * host-only powers — a clipboard the host owns, and reading/compacting a LOCAL memory
 * source for "Import from builderforce-memory" (only hosts with a filesystem have one).
 *
 * Also here: which of the tenant's IDE builds ARE Everminds, and which one a host opens on
 * — the build picker's rules, so the two desktop surfaces pick the same model.
 */
import type {
  EvermindConsoleAdapter,
  EvermindConsoleData,
  EvermindContributionStatus,
  EvermindKnowledgeAnalysis,
  EvermindKnowledgeRepair,
  EvermindProbeResult,
  EvermindTarget,
  EvermindValidateResult,
  MemoryImportReport,
} from './types';

/** An authenticated JSON call, relative to the gateway origin. Throws on a non-2xx. */
export type EvermindRequest = <T>(path: string, init?: { method?: string; body?: string }) => Promise<T>;

/**
 * What a host read from its local memory source for an import: the learnable entries,
 * each tagged with the source it came from. A JSON snapshot yields one shared `path`; a
 * Claude Code memory FOLDER yields one path per fact; a store with no files of its own
 * (Synapse's memory server) leaves `path` off every entry and the import falls back to
 * the picked `path`. `null` = the person cancelled.
 */
export interface PickedMemory {
  path: string;
  fileName: string;
  entries: Array<{ key: string; text: string; prompt?: string; path?: string }>;
}

/** The absorbed keys to compact, grouped by the source each came from. */
export interface MemoryCompactRequest {
  files: Array<{ path: string; absorbedKeys: string[] }>;
  version: number;
}

/** Host powers the gateway cannot supply. Every one is optional; the console hides what is absent. */
export interface EvermindHostPowers {
  /** Write to the host's clipboard (the diagnostics export). */
  copyText?(text: string): Promise<void>;
  /** Import step 1 — pick and read a local memory source. */
  pickMemory?(): Promise<PickedMemory | null>;
  /** Import step 3 — rewrite the absorbed entries to stubs where they live. */
  compactMemory?(req: MemoryCompactRequest): Promise<{ compacted: number; bytesSaved: number }>;
}

export interface EvermindRestOptions extends EvermindHostPowers {
  /** How this host makes an authenticated JSON call. */
  request: EvermindRequest;
  /** The Evermind's BACKING storage project — the id `/api/projects/:id/evermind` operates on. */
  projectId: number;
}

interface TenantModelRow { slug?: string; name?: string; baseModel?: string | null }
interface ExtractResponse { absorbed: string[]; skipped: Array<{ key: string; reason: string }>; merged: number; version: number }

/** The plan snapshot fields the paid-plan rule reads (`GET /api/consumption`). */
export interface PlanTier { plan?: { effective?: string } | null }

/**
 * Is this workspace on a PAID tier? The one rule, read off the `/api/consumption` plan
 * snapshot — never off `GET /llm/v1/models`, whose `premium` is the superadmin override
 * flag and whose `effectivePlan` degrades to `'free'` when auth blips. Fails CLOSED: an
 * unreadable plan is not a paid one.
 */
export function planIsPaid(snapshot: PlanTier | null | undefined): boolean {
  const effective = snapshot?.plan?.effective;
  return typeof effective === 'string' && effective !== 'free';
}

const json = (body: unknown) => JSON.stringify(body);

export function createEvermindRestAdapter(opts: EvermindRestOptions): EvermindConsoleAdapter {
  const { request: req, projectId } = opts;
  const base = `/api/projects/${projectId}/evermind`;
  const post = <T>(path: string, body?: unknown) => req<T>(`${base}${path}`, { method: 'POST', ...(body === undefined ? {} : { body: json(body) }) });
  const patch = (path: string, body: unknown) => req<unknown>(`${base}${path}`, { method: 'PATCH', body: json(body) }).then(() => undefined);

  const adapter: EvermindConsoleAdapter = {
    loadData: () => req<EvermindConsoleData>(`${base}/contributions`),
    loadSeedModels: async () => {
      const r = await req<{ models?: TenantModelRow[] }>('/api/llm/models');
      return (r.models ?? [])
        .filter((m): m is TenantModelRow & { slug: string } => typeof m.slug === 'string' && !!m.baseModel?.startsWith('evermind/'))
        .map((m) => ({ slug: m.slug, name: m.name?.trim() || m.slug }));
    },
    loadTeacherOptions: async () => {
      // Models from the gateway (it owns the coder catalog); the PAID verdict from the
      // plan snapshot — see `planIsPaid` for why not from this payload.
      const [models, plan] = await Promise.all([
        req<{ codingModels?: string[] }>('/llm/v1/models'),
        req<PlanTier>('/api/consumption').catch(() => null),
      ]);
      return { models: models.codingModels ?? [], isPaid: planIsPaid(plan) };
    },
    seedFromModel: (slug) => post(`/seed-from-model`, { slug }).then(() => undefined),
    setInference: (enabled) => patch('/inference', { enabled }),
    setMode: (mode) => patch('/mode', { mode }),
    setTeacher: (model) => patch('/teacher', { model }),
    // The POST only means "queued" — the teacher runs later in the coordinator's debounced
    // merge — so hand the console the contribution id and let it poll the status door.
    teach: (text, prompt) => post<{ contributionId?: number }>('/learn-text', { text, ...(prompt ? { prompt } : {}) })
      .then((r) => (r.contributionId ? { contributionId: r.contributionId } : {})),
    teachStatus: (contributionId) => req<EvermindContributionStatus>(`${base}/contribution/${contributionId}`),
    flush: () => post<{ merged?: number; version?: number }>('/flush').then((r) => ({ merged: r.merged ?? 0, version: r.version ?? 0 })),
    validate: (prompt) => post<EvermindValidateResult>('/validate', { prompt }),
    loadTargets: () => req<{ targets?: EvermindTarget[] }>(`${base}/targets`).then((r) => r.targets ?? []),
    probe: (prompt) => post<EvermindProbeResult>('/probe', prompt ? { prompt } : {}),
    reseed: (slug) => post<{ version?: number }>('/reseed', slug ? { slug } : {}).then((r) => ({ version: r.version ?? 0 })),
    reindex: () => post<{ reindexed?: number; skipped?: number; version?: number }>('/reindex')
      .then((r) => ({ reindexed: r.reindexed ?? 0, skipped: r.skipped ?? 0, version: r.version ?? 0 })),
    cleanup: () => post<{ discarded?: number; cachedAnswers?: number }>('/cleanup')
      .then((r) => ({ discarded: r.discarded ?? 0, cachedAnswers: r.cachedAnswers ?? 0 })),
    analyze: () => post<EvermindKnowledgeAnalysis>('/analyze', {}),
    applyFindings: (findings) => post<EvermindKnowledgeRepair>('/analyze', { apply: true, findings }),
  };
  if (opts.copyText) adapter.copyText = opts.copyText;

  const { pickMemory, compactMemory } = opts;
  if (pickMemory && compactMemory) {
    // Import: the host reads its memory source → the gateway absorbs the entries → the
    // host compacts the absorbed ones to stubs. Split by capability (local storage on the
    // host, the authenticated call here), so no layer needs powers it lacks.
    adapter.importMemory = async (): Promise<MemoryImportReport | null> => {
      const picked = await pickMemory();
      if (!picked || picked.entries.length === 0) return null;
      const res = await post<ExtractResponse>('/extract-memories', { entries: picked.entries });
      const comp = await compactMemory({ files: groupAbsorbed(picked, res.absorbed), version: res.version });
      return {
        fileName: picked.fileName,
        absorbed: res.absorbed.length,
        skipped: res.skipped.length,
        merged: res.merged,
        version: res.version,
        compacted: comp.compacted,
        bytesSaved: comp.bytesSaved,
      };
    };
  }
  return adapter;
}

/** The gateway answers with absorbed KEYS; hosts compact per SOURCE — regroup by path. */
export function groupAbsorbed(picked: PickedMemory, absorbed: readonly string[]): MemoryCompactRequest['files'] {
  const keep = new Set(absorbed);
  const byPath = new Map<string, string[]>();
  for (const e of picked.entries) {
    if (!keep.has(e.key)) continue;
    const p = e.path ?? picked.path;
    byPath.set(p, [...(byPath.get(p) ?? []), e.key]);
  }
  return [...byPath].map(([path, absorbedKeys]) => ({ path, absorbedKeys }));
}

/** One IDE build (`GET /api/ide-projects`). An Evermind build's model lives on its backing
 *  `storageProjectId`; `containerProjectId` is the Project it is grouped under. */
export interface EvermindBuild {
  id: number;
  name: string;
  modality: string;
  storageProjectId: number;
  containerProjectId: number | null;
  containerName: string | null;
}

/** The tenant's Evermind builds: the `evermind` modality, plus legacy `llm` (the retired
 *  combined modality, whose builds are Evermind projects). */
export async function loadEvermindBuilds(request: EvermindRequest): Promise<EvermindBuild[]> {
  const rows = await request<EvermindBuild[]>('/api/ide-projects');
  return (rows ?? []).filter((r) => r.modality === 'evermind' || r.modality === 'llm');
}

/**
 * Which build to open on, as its storage project id: a still-valid current choice first;
 * then the Evermind the server resolves for the active Project (its head names the build
 * it reads from); then any build grouped under that Project; then the first.
 */
export function preferredEvermindBuild(
  builds: readonly EvermindBuild[],
  pick: { current?: number | null; resolvedProjectId?: number | null; activeProjectId?: number | null } = {},
): number | null {
  const { current, resolvedProjectId, activeProjectId } = pick;
  if (current != null && builds.some((b) => b.storageProjectId === current)) return current;
  const resolved = resolvedProjectId ?? activeProjectId;
  const preferred = builds.find((b) => b.storageProjectId === resolved)
    ?? builds.find((b) => activeProjectId != null && b.containerProjectId === activeProjectId)
    ?? builds[0];
  return preferred?.storageProjectId ?? null;
}
