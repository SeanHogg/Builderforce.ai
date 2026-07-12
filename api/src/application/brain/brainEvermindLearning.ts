/**
 * brainEvermindLearning — make a project-scoped Brain conversation TRAIN the
 * project's Evermind, not just agent runs.
 *
 * Historically only agent task runs fed the Evermind learning loop; a planning
 * chat in the Brain trained nothing, which is why users saw "no indication the
 * Evermind learned from the conversation". This closes that: whenever an assistant
 * turn is persisted to a project chat AND that project's Evermind is seeded +
 * connected (the same "Learn from every run" switch that gates agent runs), the
 * turn is contributed to the coordinator — the preceding user message as the task
 * prompt, the assistant turn as the exemplar, so a pinned frontier teacher distils
 * task→ideal answer exactly as it does for a run. Best-effort + fire-and-forget:
 * a frozen / unseeded / global (non-project) chat contributes nothing, and any
 * failure never touches the chat write.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { brainChats, brainChatMessages } from '../../infrastructure/database/schema';
import { resolveEvermindTargets, dispatchProjectEvermindLearnText } from '../llm/projectEvermind';

/** A one-line assistant turn is not a teaching signal; require some substance. */
const MIN_TEACH_CHARS = 40;

interface TurnMessage { role: string; content: string }

/**
 * Why a turn was NOT contributed — a machine key the client maps to a localized,
 * muted "Evermind did not learn this turn" step so the negative case is EXPLAINED,
 * never silent. `null` when the turn WAS contributed (`learned: true`).
 *   - `not-attached` — the chat isn't bound to a project (the #1 real cause: a global
 *      Brain chat, or one created before a project was selected). Only a project chat
 *      feeds a project Evermind.
 *   - `not-seeded`   — the project has no base Evermind yet (version 0).
 *   - `frozen`       — the project's Evermind is offline-frozen (read-only), so runs
 *      and replies don't contribute.
 *   - `too-short`    — no assistant turn long enough to be a teaching signal.
 */
export type BrainLearnSkipReason = 'not-attached' | 'not-seeded' | 'frozen' | 'too-short';

/**
 * Per-Evermind result — one entry for EACH Evermind the surface's project targets (the
 * project's own head plus the heads of the IDE builds grouped under it; see
 * `resolveEvermindTargets`). Surfaced so the client can name WHICH Evermind (by
 * `projectId` / `ref`) did or didn't learn — the operator can't triage "this project has
 * no Evermind" when a project fans out to many builds' Everminds.
 */
export interface EvermindTargetOutcome {
  /** The Evermind-bearing project (the build's storage project, or the surface project). */
  projectId: number;
  /** Immutable version ref `evermind/project/<t>/<p>/v<version>`; null when unseeded. */
  ref: string | null;
  version: number;
  name: string;
  /** Did THIS Evermind receive the contribution? */
  learned: boolean;
  /** Why THIS Evermind was skipped; null when it learned. */
  reason: BrainLearnSkipReason | null;
}

/**
 * Truthful outcome of the learn gate for a persisted turn — surfaced to the client
 * (send-messages response) so the Brain run loop renders a `learn` step exactly when
 * the server DID contribute, and an EXPLAINED skip step (with {@link reason} / per-target
 * detail) when it did not. The top-level fields are a SUMMARY (any target learned, the
 * primary contributed version, the summary reason); {@link targets} carries the
 * per-Evermind breakdown WITH IDs so a fan-out to many builds is triageable.
 */
export interface BrainLearnOutcome {
  learned: boolean;
  version: number;
  /** Why nothing contributed; null/absent when at least one target learned. */
  reason?: BrainLearnSkipReason | null;
  /** Per-Evermind results (absent for a chat with no project → `not-attached`). */
  targets?: EvermindTargetOutcome[];
}

/** The gate outcome PLUS the resolved contribution inputs, so the dispatch step can
 *  reuse them without re-reading (the gate is computed once, in the route handler). */
export interface BrainLearnGate {
  outcome: BrainLearnOutcome;
  /** The chat's bound project (the surface project); null when unattached. */
  projectId: number | null;
  /** Evermind-bearing projectIds that WILL receive the contribution (seeded + connected). */
  contributedProjectIds: number[];
  /** The teachable assistant turn's content (≥ {@link MIN_TEACH_CHARS}), else null. */
  assistant: string | null;
}

/**
 * Evaluate the learn gate for the newest teachable assistant turn in `inserted`:
 * project-scoped chat + seeded, connected Evermind head (the same "Learn from every
 * run" switch that gates agent runs). Cheap enough to AWAIT before responding — the
 * head read is served through the project-Evermind read-through cache. Does NOT
 * dispatch (the slow coordinator contribution runs in {@link dispatchBrainLearn}).
 */
export async function evaluateBrainLearnGate(
  env: Env,
  db: Db,
  chatId: number,
  tenantId: number,
  inserted: ReadonlyArray<TurnMessage>,
): Promise<BrainLearnGate> {
  const assistant = [...inserted].reverse().find(
    (m) => m.role === 'assistant' && typeof m.content === 'string' && m.content.trim().length >= MIN_TEACH_CHARS,
  )?.content ?? null;
  if (!assistant) return { outcome: { learned: false, version: 0, reason: 'too-short' }, projectId: null, contributedProjectIds: [], assistant: null };

  const [chat] = await db
    .select({ projectId: brainChats.projectId })
    .from(brainChats)
    .where(eq(brainChats.id, chatId))
    .limit(1);
  const projectId = chat?.projectId ?? null;
  // Only a project chat feeds a project Evermind. This is the most common real reason a
  // turn "should learn" but doesn't: the "Learning — Connected" panel reflects the
  // SELECTED project's head, not whether THIS chat is attached to it.
  if (projectId == null) return { outcome: { learned: false, version: 0, reason: 'not-attached' }, projectId: null, contributedProjectIds: [], assistant };

  // Resolve ALL Everminds this surface targets (the project itself + the IDE builds
  // grouped under it), and evaluate each. A project can fan out to 0, 1, or many
  // Everminds — contribute to every seeded + connected one, and report the rest BY ID.
  const heads = await resolveEvermindTargets(env, db, tenantId, projectId);
  const targets: EvermindTargetOutcome[] = heads.map((h) => {
    const reason: BrainLearnSkipReason | null = h.version < 1 ? 'not-seeded' : h.mode !== 'connected' ? 'frozen' : null;
    return { projectId: h.projectId, ref: h.ref, version: h.version, name: h.name, learned: reason === null, reason };
  });
  const contributed = targets.filter((t) => t.learned);
  // Summary reason when NOTHING learned: 'frozen' only if every candidate that HAS an
  // Evermind is frozen; otherwise 'not-seeded' (no live Evermind to teach).
  const summaryReason: BrainLearnSkipReason | null =
    contributed.length > 0
      ? null
      : targets.some((t) => t.reason === 'frozen') && targets.every((t) => t.reason !== 'not-seeded' || t.version >= 1)
        ? 'frozen'
        : 'not-seeded';
  return {
    outcome: {
      learned: contributed.length > 0,
      version: contributed[0]?.version ?? 0,
      reason: summaryReason,
      targets,
    },
    projectId,
    contributedProjectIds: contributed.map((t) => t.projectId),
    assistant,
  };
}

/**
 * Dispatch the actual contribution to the project's Evermind coordinator (the slow
 * call — run in `waitUntil`). No-ops unless the pre-computed `gate` says it will
 * contribute. Resolves the task prompt = the user message this turn answered (from the
 * batch first, else the chat's most recent user message).
 */
export async function dispatchBrainLearn(
  env: Env,
  db: Db,
  chatId: number,
  tenantId: number,
  inserted: ReadonlyArray<TurnMessage>,
  gate: BrainLearnGate,
): Promise<void> {
  if (!gate.outcome.learned || !gate.assistant || gate.contributedProjectIds.length === 0) return;

  let prompt = [...inserted].reverse().find(
    (m) => m.role === 'user' && typeof m.content === 'string' && m.content.trim().length > 0,
  )?.content ?? null;
  if (!prompt) {
    const [lastUser] = await db
      .select({ content: brainChatMessages.content })
      .from(brainChatMessages)
      .where(and(eq(brainChatMessages.chatId, chatId), eq(brainChatMessages.role, 'user')))
      .orderBy(desc(brainChatMessages.seq))
      .limit(1);
    prompt = lastUser?.content ?? null;
  }

  // Fan out: contribute the SAME exemplar to every seeded + connected Evermind this
  // surface targets. Independent + best-effort — one coordinator failing never blocks
  // the others or the reply.
  await Promise.all(
    gate.contributedProjectIds.map((pid) =>
      dispatchProjectEvermindLearnText(env, tenantId, pid, gate.assistant!, undefined, prompt).catch(() => { /* per-target best-effort */ }),
    ),
  );
}

/**
 * The ONE learn-on-persist entry point — evaluate the gate for a just-persisted batch
 * of turns, schedule the (slow) coordinator contribution in the background, and return
 * the TRUTHFUL outcome for the client to render. Every surface that persists an
 * assistant turn to a project chat (the web/webview Brain route, the native VS Code
 * participant, the `@agent` addressed reply) calls THIS instead of re-wiring the gate,
 * so learning is uniform: no persist path can silently skip training. `schedule` is the
 * caller's background runner (`executionCtx.waitUntil` in a Worker); pass a passthrough
 * when none is available. Never throws — a gate/dispatch failure degrades to a
 * `learned:false` outcome and never touches the write.
 */
export async function learnFromPersistedTurns(
  env: Env,
  db: Db,
  chatId: number,
  tenantId: number,
  inserted: ReadonlyArray<TurnMessage>,
  schedule: (p: Promise<unknown>) => void,
): Promise<BrainLearnOutcome> {
  const gate: BrainLearnGate = await evaluateBrainLearnGate(env, db, chatId, tenantId, inserted).catch(
    () => ({ outcome: { learned: false, version: 0, reason: null }, projectId: null, contributedProjectIds: [], assistant: null }),
  );
  schedule(dispatchBrainLearn(env, db, chatId, tenantId, inserted, gate).catch(() => { /* never fail the write */ }));
  return gate.outcome;
}
