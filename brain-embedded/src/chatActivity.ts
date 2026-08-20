/**
 * CHAT ACTIVITY — the structured contract behind a run milestone / agent dispatch line.
 *
 * The runtime narrates itself into the conversation that spawned the work: "▶️ **Ada**
 * started working on task #41", "✅ … finished … — moved to **in review**". Those rows
 * are persisted as ordinary `role:'assistant'` messages carrying `metadata.runMilestone`
 * / `metadata.agentDispatch`, and BOTH chat renderers showed them as exactly that: an
 * assistant bubble with an emoji glued to the front, indistinguishable from something
 * the model said — and, because the server composed the sentence in English, untouchable
 * by either surface's i18n.
 *
 * This module is the fix's foundation: the metadata carries the FACTS (who, which
 * ticket, which phase, which lane, the first line of the result), and each surface
 * renders the sentence itself from its own catalogue. So the line is a system/activity
 * line rather than a bubble, and it is localized where localization actually lives —
 * next-intl on the web, `vscode.l10n.t()` in the VS Code webview.
 *
 * Older rows carry only the English `content` (the structured fields did not exist yet).
 * {@link parseChatActivity} still recognises them and reports `text: undefined`, so a
 * renderer falls back to the stored sentence: an old transcript keeps reading correctly,
 * it just isn't translated.
 */

/** The lifecycle moments a run narrates. Mirrors the api's `RunMilestonePhase`. */
export type RunMilestonePhase = 'started' | 'completed' | 'failed' | 'paused' | 'resumed' | 'cancelled';

const PHASES: readonly string[] = ['started', 'completed', 'failed', 'paused', 'resumed', 'cancelled'];

function isPhase(v: unknown): v is RunMilestonePhase {
  return typeof v === 'string' && PHASES.includes(v);
}

/** One run-lifecycle line. */
export interface RunMilestoneActivity {
  kind: 'milestone';
  phase: RunMilestonePhase;
  /** Display name of the agent, resolved server-side (it owns the workforce directory). */
  agentName: string;
  /** `task` | `epic` | `gap` — the ticket vocabulary, rendered as-is. */
  ticketKind: string;
  ticketRef: string;
  executionId: number | null;
  /** Lane the ticket moved to on completion, already de-underscored. */
  toStatus?: string;
  /** First line of the run result (completed) or the error (failed). */
  note?: string;
  /** The `ask_human` question a `paused` milestone is blocked on. */
  question?: string;
}

/** One "an agent joined this ticket" line. */
export interface AgentDispatchActivity {
  kind: 'dispatch';
  agentName: string;
  ticketKind: string;
  ticketRef: string;
}

export type ChatActivity = RunMilestoneActivity | AgentDispatchActivity;

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

/**
 * Parse a message's activity metadata, or null when it is an ordinary turn.
 *
 * Defensive by construction: a malformed blob, or one missing the structured fields,
 * yields either null or an activity whose optional fields are simply absent — never a
 * throw, and never a half-built sentence.
 */
export function parseChatActivity(msg: { metadata?: string | null }): ChatActivity | null {
  if (!msg.metadata) return null;
  let meta: Record<string, unknown>;
  try {
    const parsed = JSON.parse(msg.metadata) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    meta = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  const ticketKind = str(meta.ticketKind) ?? 'task';
  const ticketRef = str(meta.ticketRef) ?? '';
  // `agentName` was added with this contract; before it, the name lived only inside the
  // English sentence. Falling back to the ref keeps the line meaningful for old rows.
  const agentName = str(meta.agentName) ?? str(meta.agentRef) ?? '';

  if (meta.runMilestone != null && isPhase(meta.phase)) {
    return {
      kind: 'milestone',
      phase: meta.phase,
      agentName,
      ticketKind,
      ticketRef,
      executionId: typeof meta.executionId === 'number' ? meta.executionId : null,
      ...(str(meta.toStatus) ? { toStatus: str(meta.toStatus) as string } : {}),
      ...(str(meta.note) ? { note: str(meta.note) as string } : {}),
      ...(str(meta.question) ? { question: str(meta.question) as string } : {}),
    };
  }

  if (meta.agentDispatch === true) {
    return { kind: 'dispatch', agentName, ticketKind, ticketRef };
  }

  return null;
}

/** True when a message is an activity line rather than something the model said. */
export function isActivityMessage(msg: { metadata?: string | null }): boolean {
  return parseChatActivity(msg) !== null;
}

/**
 * The label templates a surface must supply to render an activity line in ITS language.
 * Every value is a template with `{…}` placeholders — never a pre-composed sentence — so
 * word order is the translator's to decide.
 */
export interface ChatActivityLabels {
  /** `{agent}`, `{kind}`, `{ref}` */
  milestoneStarted: string;
  /** `{agent}`, `{kind}`, `{ref}` */
  milestoneCompleted: string;
  /** `{agent}`, `{kind}`, `{ref}`, `{lane}` */
  milestoneCompletedWithLane: string;
  /** `{agent}`, `{kind}`, `{ref}` */
  milestoneFailed: string;
  /** `{agent}`, `{kind}`, `{ref}` */
  milestonePaused: string;
  /** `{agent}`, `{kind}`, `{ref}`, `{question}` */
  milestonePausedWithQuestion: string;
  /** `{agent}`, `{kind}`, `{ref}` */
  milestoneResumed: string;
  /** `{agent}`, `{kind}`, `{ref}` */
  milestoneCancelled: string;
  /** `{agent}`, `{kind}`, `{ref}` */
  agentDispatched: string;
}

export const DEFAULT_CHAT_ACTIVITY_LABELS: ChatActivityLabels = {
  milestoneStarted: '{agent} started working on {kind} #{ref}',
  milestoneCompleted: '{agent} finished {kind} #{ref}',
  milestoneCompletedWithLane: '{agent} finished {kind} #{ref} — moved to {lane}',
  milestoneFailed: '{agent}’s run on {kind} #{ref} failed',
  milestonePaused: '{agent} paused on {kind} #{ref} — waiting on a human answer',
  milestonePausedWithQuestion: '{agent} paused on {kind} #{ref} — needs an answer: {question}',
  milestoneResumed: '{agent} resumed work on {kind} #{ref}',
  milestoneCancelled: '{agent}’s run on {kind} #{ref} was cancelled',
  agentDispatched: '{agent} was assigned to {kind} #{ref}',
};

/** The glyph that marks each activity — one per phase, shared by both surfaces. */
export function activityIcon(activity: ChatActivity): string {
  if (activity.kind === 'dispatch') return '👤';
  switch (activity.phase) {
    case 'started': return '▶';
    case 'completed': return '✓';
    case 'failed': return '!';
    case 'paused': return '?';
    case 'resumed': return '▶';
    case 'cancelled': return '■';
    default: return '•';
  }
}

/** Tone for the activity line — drives the accent colour, not the wording. */
export function activityTone(activity: ChatActivity): 'neutral' | 'good' | 'bad' | 'waiting' {
  if (activity.kind === 'dispatch') return 'neutral';
  if (activity.phase === 'completed') return 'good';
  if (activity.phase === 'failed') return 'bad';
  if (activity.phase === 'paused') return 'waiting';
  return 'neutral';
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');
}

/**
 * Compose the activity's sentence FROM the structured facts, in the caller's language.
 * Pure, so both surfaces get identical wording rules from one implementation and the
 * only thing that differs between them is the catalogue they hand in.
 */
export function chatActivityText(activity: ChatActivity, labels: ChatActivityLabels): string {
  const base = { agent: activity.agentName, kind: activity.ticketKind, ref: activity.ticketRef };
  if (activity.kind === 'dispatch') return fill(labels.agentDispatched, base);
  switch (activity.phase) {
    case 'started':
      return fill(labels.milestoneStarted, base);
    case 'completed':
      return activity.toStatus
        ? fill(labels.milestoneCompletedWithLane, { ...base, lane: activity.toStatus })
        : fill(labels.milestoneCompleted, base);
    case 'failed':
      return fill(labels.milestoneFailed, base);
    case 'paused':
      return activity.question
        ? fill(labels.milestonePausedWithQuestion, { ...base, question: activity.question })
        : fill(labels.milestonePaused, base);
    case 'resumed':
      return fill(labels.milestoneResumed, base);
    case 'cancelled':
      return fill(labels.milestoneCancelled, base);
    default:
      return '';
  }
}
