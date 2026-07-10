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
 * Guards (Phase 5): `offline-frozen` mode rejects learns; a debounce window
 * batches bursts into a single republish; the pending queue is capped; a diff
 * taken against a STALE base is dropped (the agent recomputes against the new
 * base on its next run) rather than corrupting the merge.
 */
import { EvermindModelPackage, EvermindLMTrainer, BPETokenizer, diffCheckpoints } from '@seanhogg/builderforce-memory-engine';
import { buildDatabase, type Db } from '../database/connection';
import {
  getProjectEvermindHead,
  putProjectEvermindVersion,
  recordProjectEvermindMerge,
  projectEvermindRef,
} from '../../application/llm/projectEvermind';
import { mergeCheckpointDiffs } from '../../application/llm/evermindMerge';
import { buildEvermindTrainingText, resolveEvermindTeacherModel } from '../../application/llm/evermindTeacher';
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
/** How many recent merged contributions to retain for inspection (ring buffer). The
 *  raw run text is otherwise consumed + dropped at merge time, so this is the ONLY
 *  window into "what the model recently learned" the Evermind console can show. */
const RECENT_MAX = 30;
/** Chars of the task prompt kept per recent entry — enough for the console's
 *  "view detail" to show the whole task, not a truncated teaser. */
const RECENT_PROMPT_CHARS = 2000;
/** Chars of the learned run/exemplar text kept per recent entry. Bounded (the ring
 *  is capped at RECENT_MAX) but generous enough that "view detail" is meaningful. */
const RECENT_TEXT_CHARS = 4000;

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
  /** Readable snippet of the task prompt the run addressed (text-path only). */
  prompt?: string;
  /** Readable snippet of the run/exemplar text that was learned (text-path only). */
  text?: string;
}

const PENDING_KEY = 'pending';
const META_KEY = 'meta';
const SEQ_KEY = 'seq';
const RECENT_KEY = 'recent';

function decodeBase64(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export class ProjectEvermindCoordinatorDO implements DurableObject {
  declare readonly '__DURABLE_OBJECT_BRAND': never;
  private readonly db: Db;
  constructor(private readonly state: DurableObjectState, private readonly env: Env) {
    this.db = buildDatabase(env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname.endsWith('/learn-text')) return this.handleLearnText(request);
    if (request.method === 'POST' && url.pathname.endsWith('/learn')) return this.handleLearn(request);
    if (request.method === 'POST' && url.pathname.endsWith('/flush')) return this.handleFlush();
    if (request.method === 'GET' && url.pathname.endsWith('/recent')) return this.handleRecent();
    if (request.method === 'GET' && url.pathname.endsWith('/head')) return this.handleHead();
    return new Response('not found', { status: 404 });
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
  private async handleRecent(): Promise<Response> {
    const pending = (await this.state.storage.get<PendingEntry[]>(PENDING_KEY)) ?? [];
    const recent = (await this.state.storage.get<RecentEntry[]>(RECENT_KEY)) ?? [];
    return this.json({ pending: pending.length, recent });
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

  /** Append merged contributions to the inspection ring, newest first, capped. */
  private async recordRecent(entries: RecentEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const current = (await this.state.storage.get<RecentEntry[]>(RECENT_KEY)) ?? [];
    const next = [...entries, ...current].slice(0, RECENT_MAX);
    await this.state.storage.put(RECENT_KEY, next);
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

    const { queued, dropped } = await this.enqueue(body.tenantId, body.projectId, head.version, {
      diffB64: body.diff,
      weight: typeof body.weight === 'number' && body.weight > 0 ? body.weight : 1,
    });
    return this.json({ ok: true, queued, baseVersion: head.version, ...(dropped ? { dropped } : {}) });
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
    const { queued, dropped } = await this.enqueue(body.tenantId, body.projectId, head.version, {
      text: text.slice(0, MAX_TEXT_CHARS),
      ...(prompt ? { prompt } : {}),
      weight: typeof body.weight === 'number' && body.weight > 0 ? body.weight : 1,
    });
    return this.json({ ok: true, queued, baseVersion: head.version, ...(dropped ? { dropped } : {}) });
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
    entry: { diffB64?: string; text?: string; prompt?: string; weight: number },
  ): Promise<{ queued: number; dropped: number }> {
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
    });
    // Cost guard: cap the queue, dropping the OLDEST contributions if a project is
    // firehosing learns faster than the debounce can merge them.
    const dropped = pending.length > MAX_PENDING ? pending.splice(0, pending.length - MAX_PENDING).length : 0;
    await this.state.storage.put(PENDING_KEY, pending);

    // Debounce: only (re)arm the alarm if none is pending, so a burst folds into
    // one merge DEBOUNCE_MS after the FIRST contribution.
    const existingAlarm = await this.state.storage.getAlarm();
    if (existingAlarm == null) await this.state.storage.setAlarm(Date.now() + DEBOUNCE_MS);
    return { queued: pending.length, dropped };
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
    const mergedMeta: Array<{ id: number; kind: 'text' | 'delta'; weight: number; prompt?: string; text?: string }> = [];
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
      const effectiveTeacher = (isLM && usable.some((e) => !e.diffB64 && !!e.text))
        ? await resolveEvermindTeacherModel(this.env, this.db, tenantId, head.teacherModel)
        : null;
      const diffs: ArrayBuffer[] = [];
      const weights: number[] = [];
      let textFits = 0;
      for (const e of usable) {
        if (e.diffB64) {
          diffs.push(decodeBase64(e.diffB64));
          weights.push(e.weight);
          processedIds.push(e.id);
          mergedMeta.push({ id: e.id, kind: 'delta', weight: e.weight });
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
          new EvermindLMTrainer(lm, { epochs: 1 }).fit(seqs);
          diffs.push(diffCheckpoints(basePkg.checkpoint, lm.exportWeights()));
          weights.push(e.weight);
          textFits++;
          // Keep a readable snippet of WHAT was learned for the inspection ring. When a
          // teacher distilled this entry, the model learned from the teacher's EXEMPLAR
          // (its ideal answer), so that is what "Learned" must show — recording the raw
          // input instead makes a teach-a-task echo the question back as its own answer
          // (e.text === the task the user typed). Undistilled entries fall back to the
          // raw run text, which is the meaningful signal there.
          const learnedText = (training.distilled && training.exemplar ? training.exemplar : e.text).slice(0, RECENT_TEXT_CHARS);
          mergedMeta.push({
            id: e.id,
            kind: 'text',
            weight: e.weight,
            ...(e.prompt ? { prompt: e.prompt.slice(0, RECENT_PROMPT_CHARS) } : {}),
            text: learnedText,
          });
        } else {
          processedIds.push(e.id); // unusable (e.g. text but base isn't an evermind-lm)
        }
      }

      if (diffs.length === 0) return { merged: 0, newVersion: null }; // nothing merged (finally drops what we consumed)

      const { checkpoint, contributors } = mergeCheckpointDiffs(basePkg.checkpoint, diffs, weights);

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
      // Record the merged contributions in the inspection ring, stamped with the
      // version they landed in (newest first). Best-effort — never fail the merge.
      const at = Date.now();
      await this.recordRecent(mergedMeta.map((m) => ({ ...m, version: nextVersion, at })));
      return { merged: mergedMeta.length, newVersion: nextVersion };
    } finally {
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
