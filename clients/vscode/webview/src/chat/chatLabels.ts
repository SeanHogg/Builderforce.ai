/**
 * The editor chat's LOCALIZED COPY — everything that turns the host's label bundle
 * into strings a shared component can read.
 *
 * The host translates through `vscode.l10n`, so the strings live in the extension's
 * catalog and arrive as a flat `LabelBundle`. Shared components
 * (`<BrainTimeline>`, `<PromptOptionsMenu>`) want their own typed label shapes, and
 * building those was ~130 lines sitting at the top of the chat surface's own file,
 * where the transcript's state had to be scrolled past to reach them.
 *
 * They are pure functions of the bundle, so they belong out here where they can be
 * memoized by their one input and read without the surface around them.
 */

import {
  effortProfile,
  type Effort,
} from '@seanhogg/builderforce-brain-embedded';
import {
  DEFAULT_PROMPT_OPTIONS_LABELS,
  type BrainTimelineLabels,
  type ModelChoiceLabels,
  type PromptOptionsLabels,
} from '@seanhogg/builderforce-brain-ui';
import type { LabelBundle } from '../vscodeBridge';

/** Read a localized string from the host's bundle, falling back to English. */
export function makeT(labels: LabelBundle) {
  return (key: string, fallback: string): string => labels[key] ?? fallback;
}

/** The subset of the host bundle the shared <BrainTimeline> consumes. */
export function timelineLabels(labels: LabelBundle): Partial<BrainTimelineLabels> {
  const t = makeT(labels);
  return {
    thinking: t('tl.thinking', 'Thinking…'),
    // The ANIMATED in-flight row: which tool is running, on what, for how long.
    // Localized here like every other visible string — the phase lines are the
    // only thing on screen during a long tool call.
    live: {
      starting: t('tl.liveStarting', 'Starting…'),
      thinking: t('tl.thinking', 'Thinking…'),
      writing: t('tl.liveWriting', 'Writing the reply…'),
      tool: t('tl.liveTool', 'Running {tool}'),
      awaiting: t('tl.liveAwaiting', 'Waiting for you to approve {tool}'),
      finishing: t('tl.liveFinishing', 'Wrapping up…'),
      on: t('tl.liveOn', ' on {target}'),
      step: t('tl.liveStep', 'step {step}'),
      slow: t('tl.liveSlow', 'Still working — {elapsed} elapsed'),
      ariaLabel: t('tl.liveAria', 'Current activity'),
    },
    thoughtFor: t('tl.thoughtFor', 'Thought for {duration}'),
    thought: t('tl.thought', 'Thought'),
    replyFromThought: t('tl.replyFromThought', "Recovered from the model's reasoning — the turn ended without a separate reply."),
    you: t('tl.you', 'You'),
    assistant: t('tl.assistant', 'BuilderForce'),
    input: t('tl.input', 'Input'),
    output: t('tl.output', 'Output'),
    // Shell steps: the terminal panel's non-zero exit chip and its "printed nothing"
    // note. `{code}` is substituted by <ToolStep>, not by the host's l10n.
    noOutput: t('tl.noOutput', 'No output'),
    exitCode: t('tl.exitCode', 'Exit {code}'),
    error: t('tl.error', 'Error'),
    loading: t('tl.loading', 'Loading…'),
    empty: t('tl.empty', 'Ask BuilderForce to build or change something.'),
    copy: t('tl.copy', 'Copy'),
    copied: t('tl.copied', 'Copied'),
    replay: t('tl.replay', 'Send again'),
    rateUp: t('tl.rateUp', 'Good response'),
    rateDown: t('tl.rateDown', 'Bad response'),
    apply: t('tl.apply', 'Apply'),
    createFile: t('tl.createFile', 'Create file'),
    preview: t('tl.preview', 'Preview'),
    askSubmit: t('tl.askSubmit', 'Send'),
    askAnswered: t('tl.askAnswered', 'Answered'),
    accountOwn: t('tl.accountOwn', 'Your account'),
    accountShared: t('tl.accountShared', 'Shared pool'),
    accountByoUnused: t('tl.accountByoUnused', "Your connected account wasn't used"),
    recallTitle: t('tl.recallTitle', 'Recalled {count} memories from Evermind v{version}'),
    recallHint: t('tl.recallHint', "This project's self-learning Evermind recalled these prior learnings and grounded the answer on them."),
    learnTitle: t('tl.learnTitle', 'Contributed this turn to Evermind v{version}'),
    learnHint: t('tl.learnHint', 'This turn was contributed back to the project Evermind — it will be merged into the learned model.'),
    learnTargetContributed: t('tl.learnTargetContributed', 'Contributed to {name} (project #{projectId} v{version})'),
    learnTargetSkipped: t('tl.learnTargetSkipped', 'Skipped {name} (project #{projectId}) — {reason}'),
    reconcileTitle: t('tl.reconcileTitle', 'Reconciled {count} learned memories in Evermind v{version}'),
    reconcileHint: t('tl.reconcileHint', 'The answer restated these recalled learnings, so it updates them (write-through cognition).'),
    // Run milestones / agent dispatch — rendered as system activity lines, composed from
    // the message's structured metadata so the wording comes from the host's l10n bundle
    // rather than from the English sentence the server stored.
    activity: {
      milestoneStarted: t('tl.activityStarted', '{agent} started working on {kind} #{ref}'),
      milestoneCompleted: t('tl.activityCompleted', '{agent} finished {kind} #{ref}'),
      milestoneCompletedWithLane: t('tl.activityCompletedWithLane', '{agent} finished {kind} #{ref} — moved to {lane}'),
      milestoneFailed: t('tl.activityFailed', "{agent}'s run on {kind} #{ref} failed"),
      milestonePaused: t('tl.activityPaused', '{agent} paused on {kind} #{ref} — waiting on a human answer'),
      milestonePausedWithQuestion: t('tl.activityPausedWithQuestion', '{agent} paused on {kind} #{ref} — needs an answer: {question}'),
      milestoneResumed: t('tl.activityResumed', '{agent} resumed work on {kind} #{ref}'),
      milestoneCancelled: t('tl.activityCancelled', "{agent}'s run on {kind} #{ref} was cancelled"),
      agentDispatched: t('tl.activityDispatched', '{agent} was assigned to {kind} #{ref}'),
    },
  };
}

/**
 * One line describing what an Effort level ACTUALLY does, built from the shared
 * effort table so the copy can never claim a budget the request doesn't send.
 * The thinking budget is only mentioned when the Thinking toggle is on — that is
 * the only case in which it is spent.
 */
export function effortDesc(
  level: Effort,
  thinking: boolean,
  t: (key: string, fallback: string) => string,
): string {
  const { maxTokens, thinkingBudgetTokens } = effortProfile(level);
  const base = t(`app.effortDesc.${level}`, EFFORT_DESC_FALLBACK[level])
    .replace('{answer}', maxTokens.toLocaleString());
  if (!thinking) return base;
  return `${base} ${t('app.effortDescThinking', '+ {thinking} thinking tokens.')
    .replace('{thinking}', thinkingBudgetTokens.toLocaleString())}`;
}

/** English fallbacks for the effort descriptions (localized via the host bundle). */
export const EFFORT_DESC_FALLBACK: Record<Effort, string> = {
  quick: 'Fastest and cheapest — short, direct answers. Up to {answer} answer tokens.',
  balanced: 'The default — normal depth. Up to {answer} answer tokens.',
  thorough: 'Deepest and slowest — exhaustive, verifies its work. Up to {answer} answer tokens.',
};

/**
 * The `/` menu's copy: its own chrome from the host's label bundle, and the model
 * rows' copy from `init.modelLabels` — the SAME object the host's `Change model`
 * QuickPick renders from, so the two pickers cannot describe a row differently.
 * The menu itself is the shared control (`PromptOptionsMenu`), identical to the
 * web composer's.
 */
export function promptMenuLabels(
  t: (key: string, fallback: string) => string,
  modelLabels: ModelChoiceLabels | undefined,
): PromptOptionsLabels {
  return {
    ...DEFAULT_PROMPT_OPTIONS_LABELS,
    ...(modelLabels ?? {}),
    options: t('app.options', 'Options'),
    mode: t('app.mode', 'Mode'),
    effort: t('app.effort', 'Effort'),
    effortQuick: t('app.effortQuick', 'Quick'),
    effortBalanced: t('app.effortBalanced', 'Balanced'),
    effortThorough: t('app.effortThorough', 'Thorough'),
    thinking: t('app.thinking', 'Thinking'),
    on: t('app.on', 'On'),
    off: t('app.off', 'Off'),
    memory: t('app.memory', 'Memory'),
    conversation: t('app.conversation', 'Conversation'),
    consolidate: t('app.consolidate', 'Consolidate'),
    consolidating: t('app.consolidating', 'Consolidating…'),
    consolidateHint: t('app.consolidateHint', 'Summarize this chat into a compact context the rest of the conversation builds on'),
    fork: t('app.fork', 'Fork'),
    forking: t('app.forking', 'Forking…'),
    forkHint: t('app.forkHint', 'Summarize this chat and continue in a new one from that summary'),
    sessionUnavailable: t('app.sessionUnavailable', 'Available once this chat has a few messages and no run in flight'),
    model: t('app.model', 'Model'),
    modelInUse: t('app.modelInUse', 'Model in use'),
    searchModels: t('app.searchModels', 'Search models…'),
    filterModels: t('app.filterModels', 'Filter models'),
    chooseModel: t('app.pickModel', 'Change model'),
    noModels: t('app.noModels', 'No matching models'),
    all: t('app.all', 'All'),
    modelLocked: t('app.modelLocked', 'Model choice needs a paid plan or a connected provider account.'),
    accountSettings: t('app.accountSettings', 'Account settings'),
  };
}
