/**
 * Shared data shapes for the brain core. These define the contract the host
 * persistence adapter conforms to — they mirror the Builderforce `/api/brain`
 * payloads but are owned here so the package has no dependency on the app.
 */

/** A brain chat (conversation) record. */
export interface BrainChat {
  id: number;
  title: string;
  projectId: number | null;
  /** Where the chat was created (e.g. 'brainstorm' | 'ide' | 'project'). */
  origin?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Truthful, server-reported outcome of the project-Evermind LEARN gate for a
 * just-persisted assistant turn: whether the server WILL contribute this turn to the
 * project's Evermind (the same gate `learnFromBrainTurn` applies — project-scoped +
 * seeded + connected head) and the head version it contributes to. The run loop uses
 * it to render a TRUTHFUL `learn` step, replacing the old client-side heuristic guess
 * (which both false-positived and, for a connected-but-empty Evermind, false-negatived).
 */
/** Per-Evermind learn result — mirrors the api `EvermindTargetOutcome`. A surface's
 *  project can fan out to MANY Everminds (its own head + the IDE builds grouped under
 *  it); each is named BY ID so the operator can triage which one did/didn't learn. */
export interface EvermindLearnTarget {
  /** The Evermind-bearing project id (the build's storage project, or the surface project). */
  projectId: number;
  /** Immutable version ref `evermind/project/<t>/<p>/v<version>`; null when unseeded. */
  ref: string | null;
  version: number;
  name: string;
  learned: boolean;
  reason: 'not-attached' | 'not-seeded' | 'frozen' | 'too-short' | null;
}

export interface EvermindLearnOutcome {
  learned: boolean;
  version: number;
  /**
   * When `learned` is false, WHY the turn wasn't contributed — mirrors the api's
   * `BrainLearnSkipReason` so the run loop can render an EXPLAINED (muted) skip step
   * instead of silently showing nothing. Absent/null when the turn was contributed.
   *   `not-attached` chat isn't bound to a project · `not-seeded` no base model yet ·
   *   `frozen` Evermind is read-only · `too-short` no teachable assistant text.
   */
  reason?: 'not-attached' | 'not-seeded' | 'frozen' | 'too-short' | null;
  /**
   * Per-Evermind breakdown WITH IDs — present when the chat is project-attached. A
   * project can target 0, 1, or many Everminds; this names each so "which Evermind
   * (didn't) learn" is triageable instead of a single ambiguous "this project".
   */
  targets?: EvermindLearnTarget[];
}

/** A single message within a chat. */
export interface BrainMessage {
  id: number;
  role: string;
  content: string;
  metadata: string | null;
  seq: number;
  createdAt: string;
  /**
   * Transient (NOT persisted, NOT returned by getMessages): the learn-gate outcome
   * the send-messages response computed for THIS turn, attached to the returned
   * assistant message so the run loop can render a truthful learn step. Absent on
   * loaded/historical messages and on non-assistant turns.
   */
  evermindLearn?: EvermindLearnOutcome;
}

/**
 * The message role used for durable tool/memory STEP rows the agent loop persists
 * (so a reload can reconstruct the timeline steps — the live trace is in-memory only).
 * These rows are NOT conversation turns: their `content` is empty and the payload
 * lives in `metadata` (`{ kind:'step', … }`). The timeline reconstructs them into
 * tool/recall/learn/reconcile nodes; every OTHER consumer that treats the message
 * list as a dialogue (the model seed, a summary/PRD transcript, a plain bubble list)
 * must exclude them via {@link isStepMessage}.
 */
export const STEP_MESSAGE_ROLE = 'tool';

/** True when a persisted message is a durable tool/memory STEP row (role ===
 *  {@link STEP_MESSAGE_ROLE}) rather than a user/assistant conversation turn. */
export function isStepMessage(m: { role: string }): boolean {
  return m.role === STEP_MESSAGE_ROLE;
}

/**
 * Attach the send-messages response's TRUTHFUL learn-gate {@link EvermindLearnOutcome}
 * (transient — never persisted, never returned by getMessages) onto the assistant
 * turn(s) a `POST /chats/:id/messages` just persisted, so the Brain run loop renders a
 * `learn` step (or an EXPLAINED muted skip step, via {@link EvermindLearnOutcome.reason})
 * exactly when the server contributed — instead of a client-side guess.
 *
 * The ONE shared implementation every persistence adapter (web app + VS Code webview)
 * calls, so the two can't drift: a divergence here silently disables the learn/skip step
 * on one surface — the VSIX regression that made "Connected, yet nothing learned" an
 * unexplained mystery again while the web app showed it correctly. Generic over the
 * message shape so each surface's own `BrainMessage` type flows through unchanged.
 */
export function attachEvermindLearn<M extends { role: string }>(
  messages: M[],
  outcome: EvermindLearnOutcome | null | undefined,
): M[] {
  if (!outcome) return messages;
  return messages.map((m) => (m.role === 'assistant' ? { ...m, evermindLearn: outcome } : m));
}

/**
 * Render a one-line, plain-text status for a learn-gate {@link EvermindLearnOutcome} —
 * the non-React equivalent of the timeline's learn/skip step, for a host that streams
 * Markdown (the native VS Code `@builderforce` chat participant) rather than mounting
 * the `<BrainTimeline>`. Returns null when there's nothing worth surfacing (no outcome,
 * or a mundane `too-short` turn), so learning is VISIBLE on every surface, not just the
 * ones that render the timeline. Keep the skip phrasing in sync with brain-ui's
 * `learnSkipReason` labels.
 */
export function formatEvermindLearnStep(outcome: EvermindLearnOutcome | null | undefined): string | null {
  if (!outcome) return null;

  // Multi-target: name EACH Evermind by id + version so a fan-out is triageable — the
  // operator can't act on a bare "this project has no Evermind" when a project targets
  // many builds' Everminds. Falls through to the single-line legacy phrasing below when
  // the server didn't send a per-target breakdown.
  const targets = outcome.targets;
  if (targets && targets.length > 0) {
    const label = (t: EvermindLearnTarget): string => `${t.name} (proj #${t.projectId}${t.version ? ` v${t.version}` : ''})`;
    const learned = targets.filter((t) => t.learned);
    const skipped = targets.filter((t) => !t.learned && t.reason && t.reason !== 'too-short');
    const parts: string[] = [];
    if (learned.length > 0) parts.push(`Contributed this turn to ${learned.map(label).join(', ')}`);
    for (const t of skipped) {
      const why = t.reason === 'not-seeded' ? 'not set up yet' : t.reason === 'frozen' ? 'frozen (read-only)' : String(t.reason);
      parts.push(`skipped ${label(t)} — ${why}`);
    }
    return parts.length > 0 ? `🧠 ${parts.join('; ')}.` : null;
  }

  if (outcome.learned) return `🧠 Contributed this turn to the project Evermind (v${outcome.version}).`;
  switch (outcome.reason) {
    case 'not-attached':
      return "🧠 Not learned this turn — this chat isn't attached to a project, so it can't train a project Evermind.";
    case 'not-seeded':
      return "🧠 Not learned this turn — this project's Evermind isn't set up yet.";
    case 'frozen':
      return "🧠 Not learned this turn — this project's Evermind is frozen (read-only).";
    default:
      return null; // `too-short` (or unknown): a one-line turn isn't a teaching signal.
  }
}

/** An uploaded attachment reference attached to an outgoing message. */
export interface ChatInputAttachment {
  key: string;
  name: string;
  type: string;
  /**
   * Model-visible image source for vision turns — a `data:` URL (inlined small
   * images) or a short-lived signed public URL (large images). Present only for
   * raster images; when set, the attachment becomes an `image_url` content part
   * the vision model can actually see, instead of a plain text link.
   */
  imageUrl?: string;
}

/**
 * Modality is a free-form string in the core (e.g. 'designer' | 'video' | 'llm').
 * The host maps it to a system prompt via `BrainConfig.resolveSystemPrompt`.
 */
export type BrainModality = string;
