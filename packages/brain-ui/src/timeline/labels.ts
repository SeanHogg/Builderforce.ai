import { DEFAULT_CHAT_ACTIVITY_LABELS, type ChatActivityLabels } from '@seanhogg/builderforce-brain-embedded';
import { DEFAULT_ASK_USER_LABELS } from '../askUser';
import type { ToolStepLabels } from '../ToolStep';
import { DEFAULT_LIVE_ACTIVITY_LABELS, type LiveActivityLabels } from '../LiveActivity';
import { DEFAULT_MODEL_MOVE_LABELS, type ModelMoveLabels } from '../timelineModelMoves';
import type { ChatErrorBannerLabels } from '../ChatErrorBanner';

/**
 * Every string the transcript renders. It EXTENDS {@link ToolStepLabels} rather than
 * restating those five: the tool step is its own component with its own narrow
 * contract, and a host that passes this bundle satisfies that contract by
 * construction — which is what keeps the two from drifting apart.
 */
export interface BrainTimelineLabels extends ToolStepLabels, ModelMoveLabels {
  /** Shown on the live thinking node while a turn streams. */
  thinking: string;
  /**
   * Copy for the ANIMATED in-flight indicator (<LiveActivity>) — which tool is
   * running, on what, and for how long. Carried in this bundle so a host passes
   * ONE set of labels for the whole transcript rather than two.
   */
  live: LiveActivityLabels;
  /** "Thought for {duration}" — must contain the literal `{duration}` token. */
  thoughtFor: string;
  /** Summary of a collapsed `<think>` block inside a reply. */
  thought: string;
  /** Muted note above a reply RESCUED from the model's reasoning — the run ended
   *  inside its `<think>` block, so the transcript shows the reasoning as the reply
   *  rather than a collapsed line and nothing else. See `strandedReplyKey`. */
  replyFromThought: string;
  /** Muted note above a reply the user STOPPED mid-stream — what the model had written
   *  when Stop was pressed, kept so the reader can see what went wrong and (from the
   *  provenance chip) which model did it. See `stoppedTurn.ts` in brain-embedded. */
  stoppedReply: string;
  /** In place of a stopped turn's body when its run never started (`isStoppedBeforeStart`). */
  stoppedBeforeStart: string;
  you: string;
  assistant: string;
  /** Beside a SUB-AGENT's name: whose it is — must contain `{owner}`. */
  subagentOf: string;
  /** Beside the chat's own agent once sub-agents have spoken: it is their owner. */
  ownerTag: string;
  error: string;
  loading: string;
  empty: string;
  /** Per-message "send this again" action — re-asks the model with the same text,
   *  from a user turn or an assistant one. */
  replay: string;
  /** Thumbs up / down on an assistant reply. */
  rateUp: string;
  rateDown: string;
  apply: string;
  createFile: string;
  /** <QuestionCard> copy (ask_user) — carried here so a host passes ONE label bundle. */
  askSubmit: string;
  askAnswered: string;
  /** Provenance chip: the badge shown when the tenant's OWN connected frontier
   *  account served the turn. */
  accountOwn: string;
  /** Provenance chip: the badge for a turn served by the shared model pool. */
  accountShared: string;
  /** Provenance chip: the badge for a shared-pool turn when the tenant HAS a
   *  connected account that wasn't used — the case worth flagging. */
  accountByoUnused: string;
  /** Provenance chip tooltip: shown on the "🧠 Evermind vN" badge when the
   *  project's own self-learning model generated this reply. */
  ranOnEvermind: string;
  /** Evermind recall step title — must contain `{count}` and `{version}`. */
  recallTitle: string;
  /** Tooltip on the recall step explaining what it means. */
  recallHint: string;
  /** Memory-first answer step: a saved reply was replayed and no model ran. */
  memoryAnswerCache: string;
  /** Memory-first answer step: the project's Evermind replied and no other model ran.
   *  Must contain `{version}`. */
  memoryAnswerEvermind: string;
  /** Tooltip on the memory-first answer step. */
  memoryAnswerHint: string;
  /** Deterministic answer step: "where is X defined?" answered from the workspace symbol
   *  index and no model ran. */
  memoryAnswerSymbols: string;
  /** Tooltip on the symbol-index answer step. */
  memoryAnswerSymbolsHint: string;
  /** Evermind learn step — the turn was contributed back. Must contain `{version}`. */
  learnTitle: string;
  /** Tooltip on the learn step. */
  learnHint: string;
  /** Evermind SKIPPED-learn step — the turn did NOT contribute, and why. Must contain
   *  `{reason}` (filled from {@link learnSkipReason}). */
  learnSkippedTitle: string;
  /** Tooltip on the skipped-learn step. */
  learnSkippedHint: string;
  /** Human phrase per skip reason, substituted into {@link learnSkippedTitle}. */
  learnSkipReason: { 'not-attached': string; 'not-seeded': string; frozen: string };
  /** Per-Evermind CONTRIBUTED line for a multi-target fan-out. Must contain `{name}`,
   *  `{projectId}`, `{version}`. */
  learnTargetContributed: string;
  /** Per-Evermind SKIPPED line for a multi-target fan-out. Must contain `{name}`,
   *  `{projectId}`, `{reason}` (filled from {@link learnSkipReason}). */
  learnTargetSkipped: string;
  /** Evermind reconcile step — the turn updated learned memories. Must contain
   *  `{count}` and `{version}`. */
  reconcileTitle: string;
  /** Tooltip on the reconcile step. */
  reconcileHint: string;
  /** Auto-compaction step — the run folded older steps into a memory note to stay
   *  within the context window. Must contain `{count}`. */
  contextCompacted: string;
  /** Tooltip on the auto-compaction step. */
  contextCompactedHint: string;
  /** The button above a long transcript that renders the next page of older steps.
   *  Must contain `{count}`. */
  showEarlier: string;
  /** Below a window moved back in time: render the next page of newer steps. `{count}`. */
  showNewer: string;
  /** …or go straight back to the newest page. */
  jumpToLatest: string;
  /**
   * RUN-ACTIVITY line templates (run milestones + agent dispatch). Templates, not
   * sentences: the server records only the FACTS, and each surface composes the line in
   * its own language — which is the only way these can be localized at all, since the
   * server has no idea who will read the chat. See `chatActivity.ts` for the contract.
   */
  activity: ChatActivityLabels;
  /**
   * The error step row's sentences — the SAME bundle (and the same `chatErrorMessage`)
   * the chat's error banner reads, so a refused turn reads identically in the banner and
   * in the transcript, never as its raw code (`platform_send_disabled`). Catalog keys
   * `chatError.<field>`; omitted ⇒ the banner's English defaults.
   */
  chatError?: Partial<ChatErrorBannerLabels>;
}

export const DEFAULT_TIMELINE_LABELS: BrainTimelineLabels = {
  thinking: 'Thinking…',
  live: DEFAULT_LIVE_ACTIVITY_LABELS,
  thoughtFor: 'Thought for {duration}',
  thought: 'Thought',
  replyFromThought: "Recovered from the model's reasoning — the turn ended without a separate reply.",
  stoppedReply: 'Stopped by you — this is what the model had written when you pressed Stop.',
  stoppedBeforeStart: 'Stopped by you before the run started — nothing was done.',
  you: 'You',
  assistant: 'BuilderForce',
  subagentOf: 'sub-agent of {owner}',
  ownerTag: 'owner',
  input: 'Input',
  output: 'Output',
  error: 'Error',
  loading: 'Loading…',
  empty: 'Ask BuilderForce to build or change something.',
  copy: 'Copy',
  copied: 'Copied',
  replay: 'Send again',
  rateUp: 'Good response',
  rateDown: 'Bad response',
  apply: 'Apply',
  createFile: 'Create file',
  preview: 'Preview',
  noOutput: 'No output',
  exitCode: 'Exit {code}',
  askSubmit: DEFAULT_ASK_USER_LABELS.askSubmit,
  askAnswered: DEFAULT_ASK_USER_LABELS.askAnswered,
  accountOwn: 'Your account',
  accountShared: 'Shared pool',
  accountByoUnused: "Your connected account wasn't used",
  ranOnEvermind: "Generated by this project's Evermind model",
  recallTitle: 'Recalled {count} memories from Evermind v{version}',
  recallHint: "This project's self-learning Evermind recalled these prior learnings and grounded the answer on them.",
  memoryAnswerCache: 'Answered from a saved reply — no model was called',
  memoryAnswerEvermind: 'Answered by Evermind v{version} — no other model was called',
  memoryAnswerHint: "This project's memory already held an answer to this exact question, so it was replayed instead of running a model.",
  memoryAnswerSymbols: 'Answered from the workspace symbol index — no model was called',
  memoryAnswerSymbolsHint: 'The request only asked where these names are defined, and the symbol index resolved every one of them, so the definitions were listed instead of running a model.',
  learnTitle: 'Contributed this turn to Evermind v{version}',
  learnHint: 'This turn was contributed back to the project Evermind — it will be merged into the learned model.',
  learnSkippedTitle: 'Not learned this turn — {reason}',
  learnSkippedHint: "This turn wasn't contributed to the project Evermind. “Learning — Connected” reflects the selected project's model, not whether this chat feeds it.",
  learnSkipReason: {
    'not-attached': 'this chat isn’t attached to a project',
    'not-seeded': 'this project has no Evermind model yet',
    frozen: 'this project’s Evermind is frozen (read-only)',
  },
  learnTargetContributed: 'Contributed to {name} (project #{projectId} v{version})',
  learnTargetSkipped: 'Skipped {name} (project #{projectId}) — {reason}',
  reconcileTitle: 'Reconciled {count} learned memories in Evermind v{version}',
  reconcileHint: 'The answer restated these recalled learnings, so it updates them (write-through cognition).',
  contextCompacted: 'Context auto-compacted: older steps summarized into a memory ({count})',
  contextCompactedHint: 'The conversation outgrew its working budget, so the older part was summarized into a memory note the model keeps working from. Nothing is deleted from this transcript.',
  showEarlier: 'Show earlier steps ({count})',
  showNewer: 'Show newer steps ({count})',
  jumpToLatest: 'Jump to latest',
  ...DEFAULT_MODEL_MOVE_LABELS,
  activity: DEFAULT_CHAT_ACTIVITY_LABELS,
};
