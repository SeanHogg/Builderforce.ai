import { createDurableErrorReporter, type DurableErrorReporter } from '../../application/observability/durableErrorReporter';
/**
 * ProjectEvermindCoordinatorDO — the SINGLE WRITER for a project's Evermind.
 *
 * One instance per project (`idFromName('proj:<tenantId>:<projectId>')`). Because a
 * Durable Object runs single-threaded per id, it is the natural serialization lock
 * for concurrent learning: R2 has no compare-and-swap, so without a single owner
 * two agents merging at once would clobber each other's republish. Here they
 * queue instead.
 *
 * Flow ([[evermind-learning-architecture]]):
 *   POST /learn  — an agent pushes a weight delta (diff of its locally-adapted
 *                  replica vs the base version it pulled). Appended to a pending
 *                  queue; a debounced alarm batches a burst into ONE merge.
 *   alarm()      — drain pending → FedAvg-merge (mergeCheckpointDiffs) the diffs
 *                  taken against the CURRENT head → repackage → write next version
 *                  to R2 → record the version bump in `project_evermind`.
 *   GET /head    — current { version, ref, mode } for replicas to compare against.
 *
 * Maintenance doors (all single-writer, so none can race a merge):
 *   POST /reindex          — recompute every memory's recall embedding against the
 *                            CURRENT head (they are computed at merge time and drift
 *                            out of the query's embedding space as the model learns).
 *   POST /discard-pending  — drop queued-but-unmerged contributions (a bad batch).
 *   POST /forget           — remove specific learned memories from the recall ring.
 *
 * Guards (Phase 5): `offline-frozen` mode rejects learns; a debounce window
 * batches bursts into a single republish; the pending queue is capped; a diff
 * taken against a STALE base is dropped (the agent recomputes against the new
 * base on its next run) rather than corrupting the merge.
 */
import { EvermindModelPackage, EvermindLMTrainer, BPETokenizer, diffCheckpoints, type EvermindLM } from '@seanhogg/builderforce-memory-engine';
import { buildDatabase, type Db } from '../database/connection';
import {
  getProjectEvermindHead,
  putProjectEvermindVersion,
  recordProjectEvermindMerge,
  quarantineProjectEvermind,
  projectEvermindRef,
} from '../../application/llm/projectEvermind';
import { assessLMCoherence } from '../../application/llm/evermindRuntime';
import { mergeCheckpointDiffs } from '../../application/llm/evermindMerge';
import { buildEvermindTrainingText, resolveEvermindTeacherModel } from '../../application/llm/evermindTeacher';
import { backfillEntryProvenance } from '../../application/llm/evermindProvenance';
import type { EffectiveTeacher, RecordedSkipReason } from '../../application/llm/evermindTeacher';
import { ingestErrorEvents } from '../../application/quality/ingestEngine';
import type { NormalizedErrorEvent } from '../../application/quality/errorSpec';
import { embedTokens, cosineVec, packVec, unpackVec, EMBED_MAX_TOKENS } from '../../application/llm/evermindEmbed';
import { meanEvalLoss, type EvalExample } from '../../application/llm/evermindEval';
import type { Env } from '../../env';

/** Debounce window — a burst of learns within this window folds into one merge. */
const DEBOUNCE_MS = 15_000;
/** Hard cap on queued contributions (oldest dropped past this) — cost guard. */
const MAX_PENDING = 512;
/** Max accepted serialized-delta size (~8 MB) — a runaway push is rejected up front. */
const MAX_DIFF_BYTES = 8 * 1024 * 1024;
/** Max accepted run-text length (chars) — a text-path push is capped up front. */
const MAX_TEXT_CHARS = 8000;
/** Chars of a text entry actually fed to one adaptation pass (rest is context). */
const ADAPT_MAX_CHARS = 4000;
/** Token window length for the adaptation training sequences. */
const ADAPT_WINDOW_TOKENS = 64;
/** Max text-path adaptations (fits) run in ONE alarm — bounds the DO's per-alarm
 *  CPU; any beyond this stay queued and fold into the next debounced merge. */
const MAX_FITS_PER_ALARM = 8;
/** Default page size for the inspection surface — how many memories the console
 *  shows without asking for more. NOT a retention cap: every merged contribution is
 *  kept durably under its own `mem:` key (see {@link memKey}). It was a retention
 *  cap until 2026-08-19, which meant knowledge older than the last 24 merges could
 *  not be reviewed, corrected or forgotten — it was still in the weights and still
 *  recallable, just invisible to the audit. */
const RECENT_PAGE_MAX = 24;
/** Hard ceiling on ONE page, so a caller cannot ask the DO to materialise the whole
 *  history in a single response. The analyzer pages through instead. */
const RECENT_PAGE_LIMIT = 200;
/**
 * How many of the most recent memories RECALL scans.
 *
 * Recall is a per-turn hot path that pays one cosine comparison per memory, so it is
 * deliberately bounded where the AUDIT is not — an unbounded scan would put the
 * Worker's CPU budget at the mercy of how long the project has been learning. The
 * bound is on recall alone; nothing is deleted, and the analyzer still walks
 * everything.
 */
const RECALL_SCAN_MAX = 256;
/** How many memories ONE reindex call re-embeds. Reindexing runs a forward pass per
 *  memory, so a project with thousands would blow the request's CPU budget; the
 *  handler returns a cursor and `remaining` so the caller continues where it left
 *  off rather than silently doing part of the job. */
const REINDEX_BATCH_MAX = 64;
/** Chars of the task prompt kept per recent entry — enough for the console's
 *  "view detail" to show the whole task, not a truncated teaser. */
const RECENT_PROMPT_CHARS = 800;
/** Chars of the learned run/exemplar text kept per recent entry — generous enough
 *  that "view detail" is meaningful. Each memory is now its OWN storage value, so
 *  the 128 KiB per-value cap applies per memory (800 + 2000 chars + one packed
 *  embedding ≈ 3.5 KB) rather than to the whole history — which is what let the
 *  retention cap go. */
const RECENT_TEXT_CHARS = 2000;
/** How many per-merge training points to retain for the Knowledge Map's training
 *  readout (a small sparkline of loss + weight movement across recent versions). */
const TRAINING_MAX = 40;
/** How many held-out taught examples to keep for the automatic regression check. */
const EVAL_MAX = 6;
/** Chars of each held-out example's text kept (eval only reads the first tokens). */
const EVAL_TEXT_CHARS = 1000;
/** How many per-version eval points to retain (the ▲/▼ history). */
const EVAL_POINTS_MAX = 40;

interface PendingEntry {
  id: number;
  /** The head version this delta/text was taken against (must match at merge time). */
  baseVersion: number;
  /** base64 serialized RowDelta (diff-path); undefined for a text-path entry. */
  diffB64?: string;
  /** Raw run text (text-path) the coordinator adapts+diffs IN THE ALARM; the
   *  unified producer path so IDE/cloud/on-prem never pay training CPU themselves. */
  text?: string;
  /** Optional task prompt (the ticket) the run addressed. When present AND a teacher
   *  is pinned, the teacher ANSWERS this prompt so the SSM learns (task → ideal
   *  answer) rather than refining the raw output. */
  prompt?: string;
  /** Optional provenance for a DIFF-path contribution (which run/ticket produced the
   *  delta) — text-path entries carry their task in {@link prompt}, but a pre-diffed
   *  weight delta has no text, so this is the only thing that makes it inspectable. */
  label?: string;
  /** Optional sample weight (e.g. tokens learned) for the FedAvg merge. */
  weight: number;
}

/** Chunk token ids into fixed-length training windows (min length 2). */
function windows(ids: number[], size: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i + 1 < ids.length; i += size) {
    const seq = ids.slice(i, i + size);
    if (seq.length >= 2) out.push(seq);
  }
  return out;
}

interface CoordMeta {
  tenantId: number;
  projectId: number;
}

interface LearnBody {
  tenantId: number;
  projectId: number;
  baseVersion: number;
  diff: string; // base64 serialized RowDelta
  weight?: number;
  /** Optional provenance shown on the delta's inspection row (run/ticket). */
  label?: string;
}

interface LearnTextBody {
  tenantId: number;
  projectId: number;
  text: string;
  /** Optional task prompt threaded for teacher distillation (task → ideal answer). */
  prompt?: string;
  weight?: number;
}

/** One inspectable record of a contribution the coordinator merged into a version.
 *  The `text`/`prompt` are short snippets (the full run is not retained), so this is
 *  a human-readable trail of what the model learned, not a replayable corpus. */
interface RecentEntry {
  /** Stable unique id (the source contribution's sequence id) — lets the console
   *  target a specific learned memory (e.g. highlight it on a Validate recall). */
  id: number;
  /** 'text' = a run/exemplar adapted here; 'delta' = a pre-diffed weight delta. */
  kind: 'text' | 'delta';
  /** The version this contribution was merged INTO (head.version + 1 at merge time). */
  version: number;
  /** Epoch ms the merge landed. */
  at: number;
  /** FedAvg sample weight (tokens learned / caller-supplied). */
  weight: number;
  /** True when this contribution's weights were actually fitted and pushed into the
   *  FedAvg batch — i.e. it MOVED the neocortex, not merely got recorded. Stamped at
   *  the point the checkpoint diff is pushed, so region attribution in the Knowledge
   *  Map rests on data rather than on the ordering of statements in {@link drain}.
   *  Absent on rows written before this field existed; every such row was fitted (the
   *  merge loop had no path that recorded an unfitted contribution), so consumers must
   *  read `fitted !== false`, not `fitted === true`. */
  fitted?: boolean;
  /** Readable snippet of the task prompt the run addressed (text-path only). */
  prompt?: string;
  /** Readable snippet of the run/exemplar text that was learned (text-path only).
   *  ABSENT when a pinned teacher failed on a teach-a-task: the only text available
   *  there is the question itself, and recording that would present the question as
   *  its own answer. `skipReason` carries what to show instead. */
  text?: string;
  /** True when a frontier teacher shaped what was learned (text-path only). A teach-a-task
   *  is only meaningful when this is true — it's the frontier answer that got distilled. */
  distilled?: boolean;
  /** The frontier model that distilled this entry (present when `distilled`). */
  teacherModel?: string;
  /** Why distillation did NOT happen (present when a text entry wasn't distilled).
   *  Surfaced in the console so a silently-broken teacher is visible, not guessed at.
   *  Widened to {@link RecordedSkipReason} because the legacy-provenance backfill also
   *  writes here — a merge itself can only ever produce a `TeacherSkipReason`. */
  skipReason?: RecordedSkipReason;
  /** Operator-facing detail behind `skipReason` (HTTP status, exception message). */
  skipDetail?: string;
  /** The teacher model that was pinned but failed (present on a distillation fault). */
  attemptedTeacherModel?: string;
  /** base64-packed SSM embedding of this memory (text-path only), computed at merge
   *  time from the merged model so recall only has to embed the QUERY. Never returned
   *  to callers — it lives here purely to power {@link ProjectEvermindCoordinatorDO.handleRecall}. */
  emb?: string;
}

/** One inspectable record of the ACTUAL training that produced a version — the real
 *  signal the Knowledge Map surfaces so "teaching" reads as the weight update it is,
 *  not a black box. All fields are measured, never fabricated: `loss` is the mean
 *  next-token cross-entropy the trainer reported this merge, `moved`/`deltaNorm` are
 *  how many neocortex weights changed and how far they moved (base→merged L2). */
interface TrainingPoint {
  /** The version this training run produced (head.version + 1 at merge time). */
  version: number;
  /** Epoch ms the merge landed. */
  at: number;
  /** Mean training loss across the adaptations folded into this merge (0 when the
   *  merge was pure pre-diffed deltas, i.e. no local fit ran here to measure loss). */
  loss: number;
  /** Training sequences (token windows) fed to the trainer this merge. */
  seqs: number;
  /** How many distinct neocortex weights the merged delta changed. */
  moved: number;
  /** L2 norm of the weight movement base→merged — magnitude of the update. */
  deltaNorm: number;
  /** How many contributions were folded into this version. */
  merged: number;
}

/** One automatic pre/post regression check: the PREVIOUS vs the MERGED model scored on
 *  the SAME held-out set of the project's prior taught examples. `delta = baseLoss -
 *  newLoss` (positive = the merge improved / retained on prior tasks; negative = it
 *  regressed). Measured, never fabricated — the ▲/▼ the Knowledge Map + console show. */
interface EvalPoint {
  /** The version this check evaluated (the merge's result version). */
  version: number;
  /** Epoch ms the merge landed. */
  at: number;
  /** Mean held-out loss of the PREVIOUS version's model. */
  baseLoss: number;
  /** Mean held-out loss of the MERGED (new) version's model. */
  newLoss: number;
  /** baseLoss - newLoss (positive = improved / retained, negative = regressed). */
  delta: number;
  /** How many held-out examples the check scored. */
  evalSize: number;
}

const PENDING_KEY = 'pending';
const META_KEY = 'meta';
const SEQ_KEY = 'seq';
/** LEGACY single-value ring. Retained only so {@link ProjectEvermindCoordinatorDO.migrateLegacyRing}
 *  can fold it into the per-memory keys on first touch; never written again. */
const RECENT_KEY = 'recent';
/** Prefix for the per-memory durable keys — ONE storage value per memory, which is
 *  what lifts the 24-entry cap: the old ring was a single value under a 128 KiB
 *  limit, so retention was bounded by the value size rather than by any product
 *  requirement. */
const MEM_PREFIX = 'mem:';
/** Denormalised count of `mem:` keys. Justified: DO storage has no key-only list, so
 *  counting otherwise means materialising every memory; and the DO is the SINGLE
 *  writer, so the counter cannot drift behind a concurrent writer. Recomputed
 *  whenever a read finds it absent (which is also how it is seeded at migration). */
const MEM_COUNT_KEY = 'memCount';

/** Zero-padded so lexicographic key order is numeric id order is chronological order
 *  — which is what lets `storage.list({ reverse: true })` page newest-first without
 *  loading anything it is not returning. 12 digits covers any plausible id. */
function memKey(id: number): string {
  return `${MEM_PREFIX}${String(id).padStart(12, '0')}`;
}
/**
 * Per-DO storage schema marker. DO storage has no migration runner and ring rows are
 * never rewritten, so a shape change that has to reach ALREADY-STORED rows needs its
 * own versioned, resumable walk — this key is what makes that walk run once per DO
 * instead of on every read. `provenance` is the highest backfill version applied;
 * `provenanceCursor` is where a partially-completed walk resumes.
 */
const SCHEMA_KEY = 'schema';

interface CoordSchema {
  /** Highest applied provenance-backfill version (see PROVENANCE_SCHEMA_VERSION). */
  provenance?: number;
  /** Resume cursor (an exclusive memory id) for an in-progress provenance walk. */
  provenanceCursor?: number;
}

/** Bump when the provenance backfill's inference rules change and rows must be rewalked. */
const PROVENANCE_SCHEMA_VERSION = 1;
/**
 * Memories rewritten by ONE pass of the provenance backfill.
 *
 * The walk is deliberately bounded rather than "fix everything on first touch": a
 * project that has been learning for months holds thousands of `mem:` rows, and
 * materialising all of them in a single DO invocation would blow the CPU budget of
 * whatever request happened to touch the DO first — turning a cosmetic backfill into
 * an outage on the console's own read path. Successive reads resume from the cursor
 * and converge; each pass costs one bounded `list` plus one batched `put`.
 */
const PROVENANCE_BATCH = 128;

const TRAINING_KEY = 'training';
/** Held-out taught examples (rolling) used by the automatic regression check. */
const EVAL_KEY = 'eval';
/** Per-version eval points (the ▲/▼ history). */
const EVAL_POINTS_KEY = 'evalPoints';

function decodeBase64(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** Per-isolate cache of the loaded head model for recall embedding, keyed by the
 *  immutable version ref (a new merge writes a new ref, so this can't serve stale
 *  weights). Module-scoped so it survives across recall requests on the same isolate. */
let embedModelCache: { key: string; model: { lm: EvermindLM; tok: BPETokenizer } } | null = null;

export class ProjectEvermindCoordinatorDO implements DurableObject {
  declare readonly '__DURABLE_OBJECT_BRAND': never;
  private readonly db: Db;
  /** Bound once here so no call site can forget the runtime override. */
  private readonly reportError: DurableErrorReporter;

  constructor(private readonly state: DurableObjectState, private readonly env: Env) {
    this.reportError = createDurableErrorReporter('infrastructure/relay/ProjectEvermindCoordinatorDO.ts', env, state);
    this.db = buildDatabase(env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname.endsWith('/learn-text')) return this.handleLearnText(request);
    if (request.method === 'POST' && url.pathname.endsWith('/learn')) return this.handleLearn(request);
    if (request.method === 'POST' && url.pathname.endsWith('/flush')) return this.handleFlush();
    if (request.method === 'GET' && url.pathname.endsWith('/recent')) return this.handleRecent(request);
    if (request.method === 'GET' && url.pathname.endsWith('/contribution')) return this.handleContribution(request);
    if (request.method === 'POST' && url.pathname.endsWith('/recall')) return this.handleRecall(request);
    if (request.method === 'POST' && url.pathname.endsWith('/reindex')) return this.handleReindex(request);
    if (request.method === 'POST' && url.pathname.endsWith('/discard-pending')) return this.handleDiscardPending();
    if (request.method === 'POST' && url.pathname.endsWith('/forget')) return this.handleForget(request);
    if (request.method === 'GET' && url.pathname.endsWith('/head')) return this.handleHead();
    return new Response('not found', { status: 404 });
  }

  // -------------------------------------------------------------------------
  // Memory store — the ONE place memories are read and written.
  //
  // Every handler (inspect, recall, reindex, forget, merge) goes through these, so
  // the storage layout is decided once. Before 2026-08-19 each handler did its own
  // `storage.get(RECENT_KEY)` / `slice(0, RECENT_MAX)`, which is why lifting the cap
  // meant touching five call sites that had to agree.
  // -------------------------------------------------------------------------

  /**
   * Fold the legacy single-value ring into per-memory keys, once.
   *
   * The old layout was one `recent` array under DO storage's 128 KiB per-value cap,
   * which is what forced RECENT_MAX = 24. Migrating lazily on first touch means no
   * live storage migration and no deploy ordering to get right: whichever handler
   * runs first pays it, every later call sees the key gone. Idempotent.
   */
  private async migrateLegacyRing(): Promise<void> {
    const legacy = await this.state.storage.get<RecentEntry[]>(RECENT_KEY);
    if (!legacy) return;
    if (legacy.length > 0) {
      const batch: Record<string, RecentEntry> = {};
      // A legacy entry written before ids were stamped falls back to `at`, matching
      // what getProjectEvermindActivity already does for the console. The derived id
      // is written INTO the entry as well as into its key — a memory whose id lives
      // only in the key cannot be targeted by /forget or highlighted on a recall.
      for (const e of legacy) {
        const id = typeof e.id === 'number' ? e.id : e.at;
        batch[memKey(id)] = { ...e, id };
      }
      await this.state.storage.put(batch);
    }
    await this.state.storage.delete(RECENT_KEY);
    await this.recountMemories();
  }

  /**
   * Backfill provenance onto LEGACY learned-memory rows, in bounded resumable passes.
   *
   * Rows merged before `distilled` / `skipReason` existed carry no provenance at all,
   * and a DO ring row is never rewritten — so every reader was left inferring, forever,
   * from the one thing a bare row can prove (text identical to the prompt = the echo a
   * failed teacher leaves behind). That inference is correct but invisible: a legacy
   * refine-mode row whose teacher silently failed reads as ordinary self-learning and
   * nothing distinguishes it from a row that genuinely had no teacher.
   *
   * This materialises the inference the READER already makes, using the SAME rules as
   * `evermindLearnedStatus` (brain-ui) so no row's verdict can change by being
   * migrated — the point is to stop guessing per read, not to re-grade history:
   *   - `kind: 'delta'`         → nothing to say (a delta has no text provenance).
   *   - already provenanced     → untouched (`distilled` set, or any `skipReason`).
   *   - text === prompt (echo)  → `{ distilled: false, skipReason: 'unknown' }` → fault.
   *   - anything else           → `{ distilled: false, skipReason: 'legacy' }`  → self.
   *
   * `legacy` rather than `not_pinned`: the row proves no teacher evidence either way,
   * and claiming a teacher was never pinned would be inventing a measurement.
   *
   * Versioned + idempotent (a stored schema marker runs it once per DO), safe on a cold
   * DO (an empty keyspace completes on the first pass), and bounded to
   * {@link PROVENANCE_BATCH} rows per pass so it can never exhaust the DO's CPU budget
   * on a long ring — successive reads resume from the stored cursor.
   */
  private async migrateMemoryProvenance(): Promise<void> {
    const schema = (await this.state.storage.get<CoordSchema>(SCHEMA_KEY)) ?? {};
    if (schema.provenance === PROVENANCE_SCHEMA_VERSION) return;

    const listOpts: DurableObjectListOptions = { prefix: MEM_PREFIX, reverse: true, limit: PROVENANCE_BATCH };
    // Newest-first with an EXCLUSIVE `end`, matching readMemoryPage's cursor semantics,
    // so a resumed walk continues strictly below where the last pass stopped.
    if (typeof schema.provenanceCursor === 'number') listOpts.end = memKey(schema.provenanceCursor);
    const page = await this.state.storage.list<RecentEntry>(listOpts);

    const batch: Record<string, RecentEntry> = {};
    let last: number | undefined;
    for (const entry of page.values()) {
      last = entry.id;
      const backfilled = backfillEntryProvenance(entry);
      if (backfilled) batch[memKey(entry.id)] = backfilled;
    }
    if (Object.keys(batch).length > 0) await this.state.storage.put(batch);

    // A short page is the end of the keyspace: mark the version applied and drop the
    // cursor, so every later read costs exactly one `get` of the marker.
    const done = page.size < PROVENANCE_BATCH || last === undefined;
    await this.state.storage.put(
      SCHEMA_KEY,
      done
        ? { ...schema, provenance: PROVENANCE_SCHEMA_VERSION, provenanceCursor: undefined } satisfies CoordSchema
        : { ...schema, provenanceCursor: last } satisfies CoordSchema,
    );
  }

  /** Recompute and persist the memory count. Only called when the counter is absent
   *  or after a migration — the incremental paths maintain it. */
  private async recountMemories(): Promise<number> {
    const all = await this.state.storage.list<RecentEntry>({ prefix: MEM_PREFIX });
    await this.state.storage.put(MEM_COUNT_KEY, all.size);
    return all.size;
  }

  /** How many memories exist. Cheap: a single counter read, seeded on demand. */
  private async countMemories(): Promise<number> {
    const n = await this.state.storage.get<number>(MEM_COUNT_KEY);
    return typeof n === 'number' ? n : this.recountMemories();
  }

  /**
   * Memories newest-first.
   *
   * `before` is an exclusive cursor (an id): the page continues strictly below it, so
   * a caller pages the whole history by feeding back the last id it saw. `limit`
   * bounds what is materialised — this never loads more than one page.
   */
  private async readMemories(opts: { limit: number; before?: number } = { limit: RECENT_PAGE_MAX }): Promise<RecentEntry[]> {
    return (await this.readMemoryPage(opts)).entries;
  }

  /**
   * One page plus the answer to "is there another?".
   *
   * Reads limit + 1 and discards the extra, which is what makes the cursor exact: a
   * final page that happens to be exactly `limit` long is NOT reported as having more
   * (the caller would otherwise make one guaranteed-empty extra round trip, and a
   * cursor that lies about the end of the history is the kind of thing a paging
   * consumer builds a loop around).
   */
  private async readMemoryPage(opts: { limit: number; before?: number }): Promise<{ entries: RecentEntry[]; hasMore: boolean }> {
    await this.migrateLegacyRing();
    // Ordering matters: the legacy ring fold above is what CREATES the provenance-less
    // `mem:` rows on a DO that predates the per-memory layout, so the backfill has to
    // run after it, not beside it. Bounded + marker-gated, so this is one `get` once
    // the walk has completed.
    await this.migrateMemoryProvenance();
    const limit = Math.max(1, opts.limit);
    const listOpts: DurableObjectListOptions = {
      prefix: MEM_PREFIX,
      reverse: true,
      limit: limit + 1,
    };
    // In a reverse listing `end` is the EXCLUSIVE upper bound, so this yields the
    // memories strictly older than the cursor.
    if (typeof opts.before === 'number') listOpts.end = memKey(opts.before);
    const page = await this.state.storage.list<RecentEntry>(listOpts);
    const all = [...page.values()];
    return { entries: all.slice(0, limit), hasMore: all.length > limit };
  }

  /** One memory by id, or undefined. Goes through the same migrations as a page read
   *  so a status poll on a cold DO can never see a pre-migration shape. */
  private async readMemory(id: number): Promise<RecentEntry | undefined> {
    await this.migrateLegacyRing();
    await this.migrateMemoryProvenance();
    return this.state.storage.get<RecentEntry>(memKey(id));
  }

  /** Persist memories under their own keys, and keep the counter honest. */
  private async writeMemories(entries: RecentEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.migrateLegacyRing();
    const existing = await this.countMemories();
    const batch: Record<string, RecentEntry> = {};
    let added = 0;
    for (const e of entries) {
      const key = memKey(e.id);
      // A re-merge of the same contribution id overwrites rather than double-counts.
      if (!(key in batch) && (await this.state.storage.get<RecentEntry>(key)) === undefined) added++;
      batch[key] = e;
    }
    await this.state.storage.put(batch);
    await this.state.storage.put(MEM_COUNT_KEY, existing + added);
  }

  /** Remove memories by id. Returns how many actually existed. */
  private async deleteMemories(ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    await this.migrateLegacyRing();
    const removed = await this.state.storage.delete(ids.map(memKey));
    const n = typeof removed === 'number' ? removed : 0;
    if (n > 0) await this.state.storage.put(MEM_COUNT_KEY, Math.max(0, (await this.countMemories()) - n));
    return n;
  }

  private json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }

  private async handleHead(): Promise<Response> {
    const meta = await this.state.storage.get<CoordMeta>(META_KEY);
    if (!meta) return this.json({ version: 0, ref: null, mode: 'connected', pending: 0 });
    const head = await getProjectEvermindHead(this.env, this.db, meta.tenantId, meta.projectId);
    const pending = (await this.state.storage.get<PendingEntry[]>(PENDING_KEY)) ?? [];
    return this.json({ version: head.version, ref: head.ref, mode: head.mode, pending: pending.length });
  }

  /**
   * Inspection surface for the Evermind console: the queued-but-not-yet-merged
   * count plus the recent-contributions ring (what the model actually learned).
   * Read-only and cheap — no merge is triggered. The route in front of this caches
   * the payload behind the head version token, so a busy poll doesn't hit the DO.
   */
  private async handleRecent(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const askedLimit = Number(url.searchParams.get('limit'));
    const limit = Number.isFinite(askedLimit) && askedLimit > 0
      ? Math.min(askedLimit, RECENT_PAGE_LIMIT)
      : RECENT_PAGE_MAX;
    const askedBefore = Number(url.searchParams.get('before'));
    const before = Number.isFinite(askedBefore) && askedBefore > 0 ? askedBefore : undefined;

    const pending = (await this.state.storage.get<PendingEntry[]>(PENDING_KEY)) ?? [];
    const { entries: recent, hasMore } = await this.readMemoryPage({ limit, ...(before !== undefined ? { before } : {}) });
    const total = await this.countMemories();
    const training = (await this.state.storage.get<TrainingPoint[]>(TRAINING_KEY)) ?? [];
    const evalPoints = (await this.state.storage.get<EvalPoint[]>(EVAL_POINTS_KEY)) ?? [];
    // Strip the packed embedding — it's a recall-only internal, never part of the
    // inspection payload the console polls (keeps that read small).
    const lean = recent.map(({ emb, ...rest }) => rest);
    // `nextBefore` is the cursor for the following page, or null at the end of the
    // history. The analyzer pages on this; the console ignores it and shows page one.
    const last = recent[recent.length - 1];
    const nextBefore = hasMore && last ? last.id : null;
    // `eval` = the LATEST regression check (the ▲/▼ the chip reads); null until the
    // first merge that had a held-out set to score.
    return this.json({ pending: pending.length, recent: lean, training, eval: evalPoints[0] ?? null, total, nextBefore });
  }

  /**
   * Per-contribution status — the pollable channel behind the console's "Taught" toast.
   *
   * `/learn-text` enqueues and returns 200 immediately; the frontier teacher only runs
   * later, in the debounced merge alarm. Everything the operator actually wants to know
   * — did a teacher shape this, which one, or did distillation fault and why — is
   * therefore not knowable at the moment the POST returns. Without this door the UI had
   * no choice but to claim success optimistically and never correct itself, so a teach
   * whose teacher 503'd 15 seconds later still read as "Taught".
   *
   * Three states, and the provenance vocabulary is the RING'S — no second vocabulary is
   * invented here, because the console grades this payload with the very same
   * `evermindLearnedStatus` it grades the Learnings list with:
   *   `pending`  — still queued; the merge alarm has not consumed it.
   *   `merged`   — it is in the weights; carries the merged `version` plus the row's
   *                `distilled` / `teacherModel` / `skipReason` / `skipDetail` /
   *                `attemptedTeacherModel`. A TEACHER fault is a merged row with a
   *                `skipReason` — the contribution still learned, just un-distilled.
   *   `dropped`  — consumed by a merge but it produced no memory: its base went stale,
   *                it yielded no trainable window, or the head is not an `evermind-lm`.
   *
   * Read-only and cheap: one queue read plus (at most) one keyed memory get.
   */
  private async handleContribution(request: Request): Promise<Response> {
    const asked = Number(new URL(request.url).searchParams.get('id'));
    if (!Number.isFinite(asked) || asked <= 0) return this.json({ error: 'id is required' }, 400);
    const id = Math.trunc(asked);

    const merged = await this.readMemory(id);
    if (merged) {
      const { emb: _emb, ...rest } = merged;
      return this.json({ status: 'merged', contributionId: id, ...rest });
    }
    const pending = (await this.state.storage.get<PendingEntry[]>(PENDING_KEY)) ?? [];
    const queued = pending.find((e) => e.id === id);
    if (queued) {
      return this.json({ status: 'pending', contributionId: id, kind: queued.diffB64 ? 'delta' : 'text', queued: pending.length });
    }
    // Neither queued nor stored. A merge consumed it and it never became a memory —
    // reported as its own state rather than folded into `pending` (which would leave a
    // poller waiting forever) or into `merged` (which would claim it is in the weights).
    return this.json({ status: 'dropped', contributionId: id });
  }

  /**
   * SSM-embedding recall: rank which learned memories would answer `query`. Embeds the
   * query with the CURRENT model and cosine-compares it to each memory's stored
   * embedding (computed at merge time), so this is one forward + a cheap scan. Falls
   * back to embedding a memory's text on the fly for legacy entries that predate stored
   * embeddings. Returns `{ matches: {id, score}[], method }` — `method` tells the caller
   * whether embedding recall actually ran, so it can fall back to lexical when it can't.
   */
  private async handleRecall(request: Request): Promise<Response> {
    const meta = await this.state.storage.get<CoordMeta>(META_KEY);
    if (!meta) return this.json({ matches: [], method: 'unavailable' });
    const body = (await request.json().catch(() => null)) as { query?: unknown } | null;
    const query = typeof body?.query === 'string' ? body.query.trim() : '';
    if (!query) return this.json({ matches: [], method: 'unavailable' });

    // Bounded to the most recent window — see RECALL_SCAN_MAX. The audit is not
    // bounded; recall is, because it pays a cosine per memory on every turn.
    const recent = await this.readMemories({ limit: RECALL_SCAN_MAX });
    const textEntries = recent.filter((e) => e.kind === 'text' && (e.text || e.prompt));
    if (textEntries.length === 0) return this.json({ matches: [], method: 'embedding' });

    const model = await this.loadEmbeddingModel(meta);
    if (!model) return this.json({ matches: [], method: 'unavailable' });
    const { lm, tok } = model;

    const qVec = embedTokens(lm, tok.encode(query).slice(0, EMBED_MAX_TOKENS));
    const scored = textEntries
      .map((e) => {
        const vec = e.emb ? unpackVec(e.emb) : embedTokens(lm, tok.encode(`${e.prompt ?? ''} ${e.text ?? ''}`.trim()).slice(0, EMBED_MAX_TOKENS));
        if (vec.length === 0) return null;
        const sim = cosineVec(qVec, vec); // -1..1; negatives are "unrelated", floor at 0
        return { id: e.id, score: Math.round(Math.max(0, sim) * 1000) / 1000 };
      })
      .filter((m): m is { id: number; score: number } => m != null && m.score > 0.05)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    return this.json({ matches: scored, method: 'embedding' });
  }

  /**
   * Load the head model + tokenizer for embedding, cached per isolate keyed by the
   * immutable version ref (so repeated recalls between merges never re-read R2).
   * Returns null when unseeded, storage is absent, or the head isn't an `evermind-lm`.
   */
  private async loadEmbeddingModel(meta: CoordMeta): Promise<{ lm: EvermindLM; tok: BPETokenizer } | null> {
    const head = await getProjectEvermindHead(this.env, this.db, meta.tenantId, meta.projectId);
    if (head.version === 0 || !head.ref) return null;
    if (embedModelCache && embedModelCache.key === head.ref) return embedModelCache.model;
    const store = this.env.UPLOADS;
    if (!store) return null;
    const [baseObj, tokObj] = await Promise.all([store.get(`${head.ref}/model.evermind`), store.get(`${head.ref}/tokenizer.json`)]);
    if (!baseObj || !tokObj) return null;
    const pkg = EvermindModelPackage.fromBlob(await baseObj.arrayBuffer());
    if (pkg.manifest.modelType !== 'evermind-lm') return null;
    const tokenizer = JSON.parse(await tokObj.text()) as { vocab: Record<string, number>; merges: string[] };
    const tok = new BPETokenizer();
    tok.loadFromObjects(tokenizer.vocab, tokenizer.merges);
    const model = { lm: pkg.loadLM(), tok };
    embedModelCache = { key: head.ref, model };
    return model;
  }

  /**
   * REINDEX the recall embeddings.
   *
   * Each memory's embedding is computed once, at the merge that learned it, using the
   * model AS IT WAS THEN. Recall embeds the QUERY with the CURRENT head — so after a few
   * merges the stored vectors and the query vector live in progressively different
   * spaces, and recall quality decays silently. Nothing in the product re-derived them,
   * which is exactly the "no way to reindex" gap.
   *
   * This recomputes every text memory's embedding against the current head, in one pass,
   * on the single writer (so it can't race a merge). Idempotent and safe to re-run: it
   * writes the same ring back with fresh vectors.
   */
  private async handleReindex(request: Request): Promise<Response> {
    const meta = await this.state.storage.get<CoordMeta>(META_KEY);
    if (!meta) return this.json({ ok: false, error: 'this Evermind has no coordinator state yet' }, 409);

    // ONE batch per call. Each memory costs a forward pass, so re-embedding a long
    // history in a single request would exceed the Worker CPU budget and 5xx with
    // nothing done. The caller resumes from `nextBefore` until `remaining` is 0 —
    // partial progress is reported rather than presented as a completed reindex.
    const url = new URL(request.url);
    const askedBefore = Number(url.searchParams.get('before'));
    const before = Number.isFinite(askedBefore) && askedBefore > 0 ? askedBefore : undefined;
    const { entries: batch, hasMore } = await this.readMemoryPage({ limit: REINDEX_BATCH_MAX, ...(before !== undefined ? { before } : {}) });
    if (batch.length === 0) return this.json({ ok: true, reindexed: 0, skipped: 0, done: true, nextBefore: null, total: await this.countMemories(), version: 0 });

    const model = await this.loadEmbeddingModel(meta);
    if (!model) return this.json({ ok: false, error: 'model not available for reindexing (unseeded or artifact storage unbound)' }, 503);
    const head = await getProjectEvermindHead(this.env, this.db, meta.tenantId, meta.projectId);

    let reindexed = 0;
    let skipped = 0;
    const next = batch.map((e) => {
      const source = `${e.prompt ?? ''} ${e.text ?? ''}`.trim();
      if (e.kind !== 'text' || !source) { skipped++; return e; }
      const vec = embedTokens(model.lm, model.tok.encode(source).slice(0, EMBED_MAX_TOKENS));
      if (vec.length === 0) { skipped++; return e; }
      reindexed++;
      return { ...e, emb: packVec(vec) };
    });
    await this.writeMemories(next);

    const last = batch[batch.length - 1];
    const nextBefore = hasMore && last ? last.id : null;
    // `total` (not a computed "remaining") because counting what is strictly older
    // than the cursor would mean listing it — the caller has `total` and knows how
    // many batches it has run, which is the same progress figure without the scan.
    const total = await this.countMemories();
    return this.json({ ok: true, reindexed, skipped, done: nextBefore === null, nextBefore, total, version: head.version });
  }

  /**
   * Drop everything QUEUED but not yet merged. The operator escape hatch for a bad
   * batch (a broken importer, a teach against the wrong project, a run that contributed
   * noise): without it the only way past a poisoned queue was to merge it into the
   * weights. Already-merged knowledge is untouched — use `/forget` for that.
   */
  private async handleDiscardPending(): Promise<Response> {
    const pending = (await this.state.storage.get<PendingEntry[]>(PENDING_KEY)) ?? [];
    if (pending.length > 0) await this.state.storage.put(PENDING_KEY, []);
    return this.json({ ok: true, discarded: pending.length });
  }

  /**
   * FORGET specific learned memories by id: remove them from the inspection/recall ring
   * so they can never be recalled or used to ground a reply again.
   *
   * Honest about what this does and does not do — the ring is the RECALL surface, not
   * the weights. Removing an entry stops it being retrieved and stops it grounding
   * answers; the residual influence it had on the neocortex is superseded the normal
   * way, by teaching the corrected knowledge (write-through: update == replace). That
   * is exactly how the knowledge analyzer repairs a bad memory — forget + re-teach.
   */
  private async handleForget(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => null)) as { ids?: unknown } | null;
    const ids = Array.isArray(body?.ids) ? body.ids.filter((n): n is number => typeof n === 'number') : [];
    if (ids.length === 0) return this.json({ ok: false, error: 'ids[] is required' }, 400);
    const forgotten = await this.deleteMemories(ids);
    const remaining = await this.countMemories();
    return this.json({ ok: true, forgotten, remaining });
  }

  /**
   * Force a merge NOW ("Learn now" / distill), instead of waiting out the debounce
   * window. Drains whatever is queued in the SAME code path the alarm uses, so the
   * result is identical to a natural merge — just immediate. Returns how many
   * contributions merged and the resulting version so the caller can report it.
   */
  private async handleFlush(): Promise<Response> {
    const meta = await this.state.storage.get<CoordMeta>(META_KEY);
    if (!meta) return this.json({ ok: true, merged: 0, version: 0, pending: 0 });
    const { merged, newVersion } = await this.drain();
    const head = await getProjectEvermindHead(this.env, this.db, meta.tenantId, meta.projectId);
    const pending = (await this.state.storage.get<PendingEntry[]>(PENDING_KEY)) ?? [];
    return this.json({ ok: true, merged, version: newVersion ?? head.version, pending: pending.length });
  }

  /** Persist merged contributions as durable per-memory rows. No cap: what the model
   *  learned stays auditable for as long as it is in the weights. */
  private async recordRecent(entries: RecentEntry[]): Promise<void> {
    await this.writeMemories(entries);
  }

  /** Append one per-merge training point to the ring, newest first, capped. */
  private async recordTraining(point: TrainingPoint): Promise<void> {
    const current = (await this.state.storage.get<TrainingPoint[]>(TRAINING_KEY)) ?? [];
    const next = [point, ...current].slice(0, TRAINING_MAX);
    await this.state.storage.put(TRAINING_KEY, next);
  }

  /** Append one per-version eval (regression) point to the ring, newest first, capped. */
  private async recordEval(point: EvalPoint): Promise<void> {
    const current = (await this.state.storage.get<EvalPoint[]>(EVAL_POINTS_KEY)) ?? [];
    const next = [point, ...current].slice(0, EVAL_POINTS_MAX);
    await this.state.storage.put(EVAL_POINTS_KEY, next);
  }

  private async handleLearn(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => null)) as LearnBody | null;
    if (!body || typeof body.tenantId !== 'number' || typeof body.projectId !== 'number' || typeof body.diff !== 'string') {
      return this.json({ ok: false, error: 'tenantId, projectId, diff required' }, 400);
    }
    if (body.diff.length > MAX_DIFF_BYTES) {
      return this.json({ ok: false, error: 'delta too large' }, 413);
    }

    const head = await getProjectEvermindHead(this.env, this.db, body.tenantId, body.projectId);
    if (head.version === 0) {
      return this.json({ ok: false, error: 'project Evermind not seeded — no base model to learn against' }, 409);
    }
    // Phase 5 mode guard: a frozen model is read-only — never accept a write-back.
    if (head.mode === 'offline-frozen') {
      return this.json({ ok: false, error: 'project Evermind is offline-frozen (read-only); learning disabled', mode: head.mode }, 423);
    }
    // A diff taken against a now-stale base can't be element-merged safely — tell
    // the agent the current head so it rebases and re-pushes next run.
    if (typeof body.baseVersion === 'number' && body.baseVersion !== head.version) {
      return this.json({ ok: false, error: 'stale base — rebase against current head', headVersion: head.version }, 409);
    }

    const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, RECENT_PROMPT_CHARS) : undefined;
    const { queued, dropped, contributionId } = await this.enqueue(body.tenantId, body.projectId, head.version, {
      diffB64: body.diff,
      ...(label ? { label } : {}),
      weight: typeof body.weight === 'number' && body.weight > 0 ? body.weight : 1,
    });
    return this.json({ ok: true, queued, contributionId, baseVersion: head.version, ...(dropped ? { dropped } : {}) });
  }

  /**
   * Text-path learn — the UNIFIED producer entry point. Enqueue raw run text; the
   * ALARM adapts the base on it and merges the delta, so the fit runs HERE in the
   * DO (off the caller's request/tick) and IDE/cloud/on-prem are all cheap text
   * posters. No stale-base check: text is adapted against whatever the head is at
   * alarm time, so it can never be rebased against the wrong version.
   */
  private async handleLearnText(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => null)) as LearnTextBody | null;
    if (!body || typeof body.tenantId !== 'number' || typeof body.projectId !== 'number' || typeof body.text !== 'string') {
      return this.json({ ok: false, error: 'tenantId, projectId, text required' }, 400);
    }
    const text = body.text.trim();
    if (text.length < 20) return this.json({ ok: false, error: 'text too short' }, 400);

    const head = await getProjectEvermindHead(this.env, this.db, body.tenantId, body.projectId);
    if (head.version === 0) return this.json({ ok: false, error: 'project Evermind not seeded — no base model to learn against' }, 409);
    if (head.mode === 'offline-frozen') return this.json({ ok: false, error: 'project Evermind is offline-frozen (read-only); learning disabled', mode: head.mode }, 423);

    const prompt = typeof body.prompt === 'string' && body.prompt.trim() ? body.prompt.trim().slice(0, MAX_TEXT_CHARS) : undefined;
    const { queued, dropped, contributionId } = await this.enqueue(body.tenantId, body.projectId, head.version, {
      text: text.slice(0, MAX_TEXT_CHARS),
      ...(prompt ? { prompt } : {}),
      weight: typeof body.weight === 'number' && body.weight > 0 ? body.weight : 1,
    });
    return this.json({ ok: true, queued, contributionId, baseVersion: head.version, ...(dropped ? { dropped } : {}) });
  }

  /**
   * Shared tail of /learn and /learn-text (DRY): stamp meta, assign a sequence id,
   * append the entry, cap the queue (dropping oldest), and (re)arm the debounced
   * merge alarm so a burst folds into one republish.
   */
  private async enqueue(
    tenantId: number,
    projectId: number,
    baseVersion: number,
    entry: { diffB64?: string; text?: string; prompt?: string; label?: string; weight: number },
  ): Promise<{ queued: number; dropped: number; contributionId: number }> {
    await this.state.storage.put(META_KEY, { tenantId, projectId } satisfies CoordMeta);
    const seq = ((await this.state.storage.get<number>(SEQ_KEY)) ?? 0) + 1;
    await this.state.storage.put(SEQ_KEY, seq);

    const pending = (await this.state.storage.get<PendingEntry[]>(PENDING_KEY)) ?? [];
    pending.push({
      id: seq,
      baseVersion,
      weight: entry.weight,
      ...(entry.diffB64 ? { diffB64: entry.diffB64 } : {}),
      ...(entry.text ? { text: entry.text } : {}),
      ...(entry.prompt ? { prompt: entry.prompt } : {}),
      ...(entry.label ? { label: entry.label } : {}),
    });
    // Cost guard: cap the queue, dropping the OLDEST contributions if a project is
    // firehosing learns faster than the debounce can merge them.
    const dropped = pending.length > MAX_PENDING ? pending.splice(0, pending.length - MAX_PENDING).length : 0;
    await this.state.storage.put(PENDING_KEY, pending);

    // Debounce: only (re)arm the alarm if none is pending, so a burst folds into
    // one merge DEBOUNCE_MS after the FIRST contribution.
    const existingAlarm = await this.state.storage.getAlarm();
    if (existingAlarm == null) await this.state.storage.setAlarm(Date.now() + DEBOUNCE_MS);
    // The sequence id is handed BACK to the caller: it is the same id the merged
    // memory is stored under (`mem:<id>`), which is what makes one contribution
    // pollable from enqueue through to its merged provenance — see handleContribution.
    return { queued: pending.length, dropped, contributionId: seq };
  }

  /** The debounced-merge entry point — drains the queue in the background. */
  async alarm(): Promise<void> {
    await this.drain();
  }

  /**
   * Drain the pending queue into ONE merged version and return what happened, so
   * both the debounced {@link alarm} and the on-demand {@link handleFlush} share the
   * exact merge path (DRY). `merged` is the number of contributions folded in;
   * `newVersion` is the version they were merged into (null when nothing merged).
   */
  private async drain(): Promise<{ merged: number; newVersion: number | null }> {
    const meta = await this.state.storage.get<CoordMeta>(META_KEY);
    const pending = (await this.state.storage.get<PendingEntry[]>(PENDING_KEY)) ?? [];
    if (!meta || pending.length === 0) return { merged: 0, newVersion: null };

    const { tenantId, projectId } = meta;
    const head = await getProjectEvermindHead(this.env, this.db, tenantId, projectId);
    if (head.version === 0 || !head.ref) {
      // Lost its base somehow — drop the queue so it can't wedge.
      await this.state.storage.delete(PENDING_KEY);
      return { merged: 0, newVersion: null };
    }

    // Snapshot the entries we'll process by id, so a /learn that lands mid-merge
    // is preserved (re-queued) rather than silently cleared.
    const snapshot = pending.slice();
    const usable = snapshot.filter((e) => e.baseVersion === head.version);

    if (usable.length === 0) {
      // Everything queued is stale against the current head — discard and stop.
      await this.dropProcessed(snapshot.map((e) => e.id));
      return { merged: 0, newVersion: null };
    }

    // Only the entries we actually consume this alarm are cleared; text entries
    // beyond MAX_FITS_PER_ALARM stay queued for the next debounced merge.
    const processedIds: number[] = [];
    // Per-entry provenance for the inspection ring, stamped with the merged version
    // once the merge lands (parallel to `diffs`/`weights`).
    const mergedMeta: Array<Omit<RecentEntry, 'version' | 'at'>> = [];
    // Real training telemetry accumulated across the adaptations this merge runs, so
    // the Knowledge Map can show what teaching actually did to the neocortex weights.
    let lossSum = 0;
    let lossN = 0;
    let seqTotal = 0;
    // Teacher-distillation faults accumulated this alarm. Beyond the greppable
    // console.warn, each is ingested into the Quality/error-observability pillar
    // (error_groups) so a tenant whose pinned teacher is 4xx-ing every merge raises
    // a real alert on /quality instead of failing silently. [[quality-error-observability-pillar]]
    const faultEvents: NormalizedErrorEvent[] = [];
    try {
      const store = this.env.UPLOADS;
      if (!store) return { merged: 0, newVersion: null }; // no R2 → can't merge; leave everything pending for a later alarm
      const baseObj = await store.get(`${head.ref}/model.evermind`);
      const tokObj = await store.get(`${head.ref}/tokenizer.json`);
      if (!baseObj || !tokObj) {
        await this.dropProcessed(snapshot.map((e) => e.id));
        return { merged: 0, newVersion: null };
      }

      const basePkg = EvermindModelPackage.fromBlob(await baseObj.arrayBuffer());
      const tokenizer = JSON.parse(await tokObj.text()) as { vocab: Record<string, number>; merges: string[] };
      const isLM = basePkg.manifest.modelType === 'evermind-lm';
      const tok = new BPETokenizer();
      if (isLM) tok.loadFromObjects(tokenizer.vocab, tokenizer.merges);

      // Build the batch of weight deltas to FedAvg. Diff-path entries decode
      // directly; text-path entries are ADAPTED here (fresh base copy → fit → diff)
      // — the fit that IDE/cloud/on-prem deliberately don't run on their own.
      // Per-alarm fit cap — env-tunable (EVERMIND_MAX_FITS_PER_ALARM) so the DO's
      // per-alarm CPU envelope can be lowered without a code change.
      const maxFits = Math.max(1, Math.trunc(Number(this.env.EVERMIND_MAX_FITS_PER_ALARM)) || MAX_FITS_PER_ALARM);
      // Resolve the effective (budget-gated) teacher ONCE per alarm — the token scan
      // is a per-tenant aggregate constant across this batch, so it must not run per
      // entry. null unless a teacher is pinned AND there's trainable text to distil.
      const effectiveTeacher: EffectiveTeacher = (isLM && usable.some((e) => !e.diffB64 && !!e.text))
        ? await resolveEvermindTeacherModel(this.env, this.db, tenantId, head.teacherModel)
        : { model: null, reason: 'not_pinned' };
      const diffs: ArrayBuffer[] = [];
      const weights: number[] = [];
      let textFits = 0;
      for (const e of usable) {
        if (e.diffB64) {
          diffs.push(decodeBase64(e.diffB64));
          weights.push(e.weight);
          processedIds.push(e.id);
          // A pre-diffed delta has no text; its `label` (run/ticket provenance) is what
          // makes the row inspectable — surface it in the same `prompt` slot text entries
          // use, so the console/Learnings render it without a special case.
          mergedMeta.push({ id: e.id, kind: 'delta', weight: e.weight, ...(e.label ? { prompt: e.label.slice(0, RECENT_PROMPT_CHARS) } : {}) });
        } else if (e.text && isLM) {
          if (textFits >= maxFits) continue; // defer — leave queued for next alarm
          processedIds.push(e.id); // consumed even if it yields no trainable window
          // Teacher distillation: when a (budget-gated) frontier teacher is in effect,
          // adapt on that model's EXEMPLAR instead of the raw run text — feeding any
          // frontier LLM back into the Evermind. With the run's TASK PROMPT threaded
          // through, the teacher ANSWERS the task (task → ideal answer); otherwise it
          // refines the output. A teacher failure falls back to the raw text so the
          // contribution is never lost. [[evermind-learning-architecture]]
          const training = await buildEvermindTrainingText(
            this.env, tenantId, effectiveTeacher, e.text, { prompt: e.prompt ?? null },
          );
          const ids = tok.encode(training.text.slice(0, ADAPT_MAX_CHARS));
          const seqs = windows(ids, ADAPT_WINDOW_TOKENS);
          if (seqs.length === 0) continue;
          const lm = basePkg.loadLM();
          const history = new EvermindLMTrainer(lm, { epochs: 1 }).fit(seqs);
          // Record the trainer's real per-epoch mean loss (final epoch) so the map's
          // training readout reflects measured convergence, not a stand-in.
          const loss = history.length > 0 ? history[history.length - 1]! : 0;
          if (Number.isFinite(loss) && loss > 0) { lossSum += loss; lossN++; }
          seqTotal += seqs.length;
          diffs.push(diffCheckpoints(basePkg.checkpoint, lm.exportWeights()));
          weights.push(e.weight);
          textFits++;
          // Keep a readable snippet of WHAT was learned for the inspection ring. When a
          // teacher distilled this entry, the model learned from the teacher's EXEMPLAR
          // (its ideal answer), so that is what "Learned" must show — recording the raw
          // input instead makes a teach-a-task echo the question back as its own answer
          // (e.text === the task the user typed). Undistilled entries fall back to the
          // raw run text, which is the meaningful signal there — EXCEPT on a teach-a-task,
          // where the raw text IS the question: producing no answer is a fault to report,
          // not an echo to display, so we record the reason and omit the text entirely.
          const isEcho = !training.distilled && !!e.prompt && e.text.trim() === e.prompt.trim();
          const learnedText = training.distilled && training.exemplar ? training.exemplar : e.text;
          mergedMeta.push({
            id: e.id,
            kind: 'text',
            weight: e.weight,
            // The diff for this entry went into the batch immediately above, so it
            // provably moved neocortex weights. Recorded explicitly — the Knowledge
            // Map credits the Neocortex off this flag, not off `kind`.
            fitted: true,
            ...(e.prompt ? { prompt: e.prompt.slice(0, RECENT_PROMPT_CHARS) } : {}),
            ...(isEcho ? {} : { text: learnedText.slice(0, RECENT_TEXT_CHARS) }),
            distilled: training.distilled,
            ...(training.teacherModel ? { teacherModel: training.teacherModel } : {}),
            ...(training.skipReason ? { skipReason: training.skipReason } : {}),
            ...(training.skipDetail ? { skipDetail: training.skipDetail } : {}),
            ...(training.attemptedTeacherModel ? { attemptedTeacherModel: training.attemptedTeacherModel } : {}),
          });
          // A PINNED teacher that produced nothing is an operational fault (bad model
          // pin, no credit, vendor down) that otherwise fails silently — the exact way
          // "teacher mode isn't working" stayed invisible. Log it so it's greppable.
          if (training.attemptedTeacherModel) {
            console.warn(
              `[evermind] teacher distillation failed tenant=${tenantId} project=${projectId} ` +
              `model=${training.attemptedTeacherModel} reason=${training.skipReason} detail=${training.skipDetail ?? 'none'}`,
            );
            // Group ALL faults for the same (project, teacher, reason) into ONE
            // error_groups row whose count climbs — a stable fingerprint keyed on those,
            // never the per-entry id, so a repeatedly-failing teacher is one climbing
            // alert rather than a flood of singletons.
            faultEvents.push({
              fingerprint: `evermind-teacher-fault:${projectId}:${training.attemptedTeacherModel}:${training.skipReason ?? 'unknown'}`,
              type: 'EvermindTeacherDistillationFault',
              message:
                `Teacher distillation failed for pinned model ${training.attemptedTeacherModel}: ` +
                `${training.skipReason ?? 'unknown'}${training.skipDetail ? ` — ${training.skipDetail}` : ''}`,
              level: 'error',
              timestamp: new Date().toISOString(),
              source: 'evermind-teacher',
              tags: {
                service: 'evermind',
                teacherModel: training.attemptedTeacherModel,
                ...(training.skipReason ? { skipReason: String(training.skipReason) } : {}),
              },
              context: { tenantId, projectId, entryId: e.id },
            });
          }
        } else {
          processedIds.push(e.id); // unusable (e.g. text but base isn't an evermind-lm)
        }
      }

      if (diffs.length === 0) return { merged: 0, newVersion: null }; // nothing merged (finally drops what we consumed)

      const { checkpoint, contributors, mergedRows, deltaNorm } = mergeCheckpointDiffs(basePkg.checkpoint, diffs, weights);

      // Repackage the merged weights as the next immutable version (recomputes the
      // manifest checksum), carrying the base name + model card forward.
      const lm = basePkg.loadLM();
      lm.loadWeights(checkpoint);
      const nextVersion = head.version + 1;
      const nextPkg = EvermindModelPackage.fromLM(lm, {
        name: basePkg.manifest.name,
        version: String(nextVersion),
        card: basePkg.manifest.card,
      });

      await putProjectEvermindVersion(store, tenantId, projectId, nextVersion, nextPkg.toBlob(), tokenizer);
      await recordProjectEvermindMerge(this.env, this.db, tenantId, projectId, nextVersion, contributors);

      // Verify the new version is the one we wrote (a concurrent merge is impossible
      // — single DO — but a forward-only DB guard means we trust the row).
      void projectEvermindRef(tenantId, projectId, nextVersion);

      // ── Post-merge fitness re-benchmark ────────────────────────────────────
      // Promotion to `inferenceEnabled` is benchmark-gated, but EVERY merge changes the
      // weights — so a head that passed the probe at version N can degrade into
      // gibberish by version N+k with nothing re-checking it, and the serve path picks
      // up the new ref immediately. That is how a head ended up answering users in
      // invented words. Re-grade the JUST-MERGED model here (the coordinator alarm, off
      // the request path, with the model already in memory — no R2 reload) using the
      // same probe + the same `looksLikeCoherentText` bar the enable gate uses, and
      // quarantine it through the same shared writer if it is no longer fit to serve.
      // Only for a head that is actually serving; best-effort, never fails the merge.
      if (isLM && head.inferenceEnabled) {
        try {
          const fitness = assessLMCoherence(lm, tok);
          if (!fitness.ready) {
            await quarantineProjectEvermind(
              this.env, this.db, tenantId, projectId,
              `Auto-quarantined at v${nextVersion}: the merged model failed the coherence probe `
              + `(${Math.round(fitness.passRate * 100)}% of samples readable). Learning continues; `
              + 're-enable inference once it passes, or pin a frontier teacher to distil into it.',
            );
            console.warn(
              `[evermind] quarantined tenant=${tenantId} project=${projectId} v=${nextVersion} `
              + `passRate=${fitness.passRate.toFixed(2)} — merged model is not fit to serve`,
            );
          }
        } catch (error) { /* best-effort: a probe failure must never wedge the merge */ 
          this.reportError(error, { operation: "drain" });
        }
      }
      // Embed each text memory with the JUST-MERGED model so semantic recall (Validate)
      // only has to embed the query later — the vector is computed once, here, off the
      // recall path. isLM is guaranteed when any text entry exists (tok is loaded then).
      if (isLM) {
        for (const m of mergedMeta) {
          if (m.kind !== 'text') continue;
          const src = `${m.prompt ?? ''} ${m.text ?? ''}`.trim();
          if (!src) continue;
          try {
            m.emb = packVec(embedTokens(lm, tok.encode(src).slice(0, EMBED_MAX_TOKENS)));
          } catch (error) { /* best-effort: a failed embed just falls back to lexical recall */ 
            this.reportError(error, { operation: "drain" });
          }
        }
      }
      // Cache the freshly-merged model for recall on this isolate (its ref is the new
      // version, so a later merge's new ref naturally supersedes this entry).
      embedModelCache = { key: projectEvermindRef(tenantId, projectId, nextVersion), model: { lm, tok } };
      // Record the merged contributions in the inspection ring, stamped with the
      // version they landed in (newest first). Best-effort — never fail the merge.
      const at = Date.now();
      await this.recordRecent(mergedMeta.map((m) => ({ ...m, version: nextVersion, at })));
      // Record the measured training telemetry for this version (loss + how far the
      // neocortex weights actually moved) — the data the Knowledge Map surfaces.
      await this.recordTraining({
        version: nextVersion,
        at,
        loss: lossN > 0 ? lossSum / lossN : 0,
        seqs: seqTotal,
        moved: mergedRows,
        deltaNorm,
        merged: mergedMeta.length,
      });

      // Automatic regression check: score the PREVIOUS vs the MERGED model on the
      // held-out set of examples taught BEFORE this merge, and record the loss delta so
      // the version chip can show ▲ (improved / retained) or ▼ (regressed). Best-effort:
      // any failure just skips the point, never the merge. Only meaningful for an LM.
      if (isLM) {
        try {
          const evalSet = (await this.state.storage.get<EvalExample[]>(EVAL_KEY)) ?? [];
          if (evalSet.length > 0) {
            const baseEvalLM = basePkg.loadLM(); // fresh: the PREVIOUS version's weights
            const baseLoss = meanEvalLoss(baseEvalLM, tok, evalSet);
            const newLoss = meanEvalLoss(lm, tok, evalSet); // `lm` holds the merged weights
            if (baseLoss != null && newLoss != null) {
              await this.recordEval({ version: nextVersion, at, baseLoss, newLoss, delta: baseLoss - newLoss, evalSize: evalSet.length });
            }
          }
          // Grow the held-out set with THIS merge's learned examples, for the NEXT merge's
          // check (kept AFTER scoring so this batch never grades its own fit).
          const fresh: EvalExample[] = mergedMeta
            .filter((m) => m.kind === 'text' && !!m.text)
            .map((m) => ({ ...(m.prompt ? { prompt: m.prompt } : {}), text: m.text!.slice(0, EVAL_TEXT_CHARS) }));
          if (fresh.length > 0) {
            await this.state.storage.put(EVAL_KEY, [...fresh, ...evalSet].slice(0, EVAL_MAX));
          }
        } catch (error) { /* best-effort: never fail the merge over an eval point */ 
          this.reportError(error, { operation: "drain" });
        }
      }
      return { merged: mergedMeta.length, newVersion: nextVersion };
    } finally {
      // Surface any teacher-distillation faults from this alarm to the Quality pillar,
      // on EVERY exit path (including "nothing merged" and a throw). Collector-less
      // in-app source (`id: null`) — error_groups.collector_id is nullable — routed
      // straight to this project. Best-effort: a broken teacher must never wedge drain.
      if (faultEvents.length > 0) {
        try {
          await ingestErrorEvents(this.db, this.env, { id: null, tenantId, projectId, defaultProjectId: projectId }, faultEvents);
        } catch (error) { /* best-effort: the console.warn above is the fallback record */ 
          this.reportError(error, { operation: "drain" });
        }
      }
      // Clear only what we consumed; anything that arrived mid-merge OR was deferred
      // past the per-alarm fit cap stays queued, and we re-arm to fold it in next.
      await this.dropProcessed(processedIds);
      const remaining = (await this.state.storage.get<PendingEntry[]>(PENDING_KEY)) ?? [];
      if (remaining.length > 0) await this.state.storage.setAlarm(Date.now() + DEBOUNCE_MS);
    }
    // Unreachable in practice (every path inside the try returns), but satisfies the
    // compiler's control-flow analysis for the try/finally.
    return { merged: 0, newVersion: null };
  }

  /** Remove processed entries by id, preserving any that arrived concurrently. */
  private async dropProcessed(ids: number[]): Promise<void> {
    const idSet = new Set(ids);
    const current = (await this.state.storage.get<PendingEntry[]>(PENDING_KEY)) ?? [];
    const remaining = current.filter((e) => !idSet.has(e.id));
    if (remaining.length > 0) await this.state.storage.put(PENDING_KEY, remaining);
    else await this.state.storage.delete(PENDING_KEY);
  }
}
