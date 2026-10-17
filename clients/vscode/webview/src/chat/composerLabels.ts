/**
 * THE ONE mapping from the host's label bundle to the shared composer's copy — the
 * prompt box, its `+` menu and trailing button, the `/` Work panel (Mode, Effort,
 * Model), its Status tab (plan, meters, Evermind) and the spend & savings readouts.
 *
 * The host translates every string through `vscode.l10n` (see `builderforcePanel.ts`
 * and `src/workStatusLabels.ts`); this only reads the keys back and hands brain-ui its
 * typed shapes. Parameterised copy stays a FUNCTION of the figure the composer
 * supplies, so the editor's `{placeholder}` convention formats the number, not
 * brain-ui's English template.
 */

import type { Effort, SavingsSourceKey } from '@seanhogg/builderforce-brain-embedded';
import type {
  BrainComposerLabels,
  ComposerLabels,
  ModelChoiceLabels,
  SpendLabels,
  WorkStatusLabels,
} from '@seanhogg/builderforce-brain-ui';
import type { LabelBundle } from '../vscodeBridge';
import { makeT, promptMenuLabels } from './chatLabels';

type T = (key: string, fallback: string) => string;

const EFFORT_DESC_FALLBACK: Record<Effort, string> = {
  quick: 'Fastest and cheapest — short, direct answers. Up to {answer} answer tokens.',
  balanced: 'The default — normal depth. Up to {answer} answer tokens.',
  thorough: 'Deepest and slowest — exhaustive, verifies its work. Up to {answer} answer tokens.',
};

function composerCopy(t: T, locale: string | undefined): ComposerLabels {
  const n = (v: number) => v.toLocaleString(locale);
  return {
    placeholder: t('app.placeholder', 'Ask BuilderForce to build or change something…'),
    add: t('app.add', 'Add'),
    upload: t('app.uploadFile', 'Upload from computer'),
    uploading: t('app.uploading', 'Uploading…'),
    addContext: t('app.addContext', 'Add context'),
    browseWeb: t('app.browseWeb', 'Browse the web'),
    on: t('app.on', 'On'),
    off: t('app.off', 'Off'),
    remove: t('app.remove', 'Remove'),
    send: t('app.send', 'Send'),
    queueSend: t('app.queueSend', 'Queue message — sends when the current run finishes'),
    stop: t('app.stop', 'Stop'),
    dictate: t('app.dictate', 'Dictate'),
    stopDictation: t('app.stopDictation', 'Stop dictation'),
    modeLabel: (mode) => (mode === 'work' ? t('app.modeWork', 'Work') : t('app.modeChat', 'Chat')),
    modeHint: (mode) => (mode === 'work'
      ? t('app.modeWorkHint', 'Turn what we agree into tracked work — open the ticket, staff it, and dispatch an agent to run it')
      : t('app.modeChatHint', 'Just answer — read and reason as much as needed, but do not open or dispatch board work')),
    memoryOnHint: t('app.memoryOnHint', 'Memory on — this chat recalls and learns from the project Evermind'),
    memoryOffHint: t('app.memoryOffHint', 'Memory off — this chat is a scratch space (no recall, no learning)'),
    memoryUnavailable: t('app.memoryUnavailable', 'This chat has no project memory to recall from — link it to a project first'),
    autoModeHint: t('app.autoModeHint', 'Auto-approve tool actions without asking'),
    effortDesc: (level, answer) => t(`app.effortDesc.${level}`, EFFORT_DESC_FALLBACK[level]).replace('{answer}', n(answer)),
    effortThinkingSuffix: (thinking) => t('app.effortDescThinking', '+ {thinking} thinking tokens.').replace('{thinking}', n(thinking)),
    thinkingOnDesc: (budget) => t(
      'app.thinkingOnDesc',
      'The model reasons before answering, with a {budget}-token thinking budget at this effort. Slower, better on hard problems.',
    ).replace('{budget}', n(budget)),
    thinkingOffDesc: t('app.thinkingOffDesc', 'Off — the model answers directly. Turn on for a reasoning pass before the answer.'),
  };
}

const METER_KEYS = [
  'ai_tokens', 'cloud_runs', 'stage_sandbox_runs', 'ingestion', 'error_events',
  'outbound_fetches', 'feedback_submissions', 'replay_recordings',
] as const;
const UNIT_KEYS = ['tokens', 'bytes', 'runs', 'events', 'fetches', 'submissions', 'sandbox_runs', 'recordings'] as const;
const PLAN_KEYS = ['free', 'pro', 'teams', 'enterprise'] as const;
const BILLING_KEYS = ['past_due', 'canceled', 'trialing', 'incomplete'] as const;
const SAVING_SOURCES: readonly SavingsSourceKey[] = [
  'prompt_cache', 'memory_answer', 'evermind_answer', 'response_cache', 'context_trim', 'recall_overhead',
];

/** Pick the bundle's value for each key under `prefix`, leaving unmapped ones to brain-ui's defaults. */
function keyed(labels: LabelBundle, prefix: string, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = labels[`${prefix}${k}`];
    if (v) out[k] = v;
  }
  return out;
}

/** The `/` menu's Status tab copy. Absent keys fall back to brain-ui's English. */
export function workStatusLabelsFrom(labels: LabelBundle): Partial<WorkStatusLabels> {
  const t = makeT(labels);
  return {
    loading: t('app.statusLoading', 'Loading account…'),
    account: t('app.account', 'Account'),
    plan: t('app.plan', 'Plan'),
    resets: t('app.resets', 'Resets'),
    limitsLifted: t('ws.limitsLifted', 'limits lifted'),
    limitsLiftedHint: t('ws.limitsLiftedHint', 'You are a superadmin operator, so every limit is lifted for you — the plan’s own limits still apply to its members.'),
    usage: t('app.usage', 'Usage'),
    usageEmpty: t('app.usageEmpty', 'No usage meters for this plan.'),
    unlimited: t('app.unlimited', 'Unlimited'),
    meterOf: t('ws.meterOf', '{used} / {limit} {unit}'),
    upgrade: t('app.upgrade', 'Upgrade'),
    managePlan: t('app.managePlan', 'Manage plan'),
    billing: keyed(labels, 'ws.billing.', BILLING_KEYS),
    plans: keyed(labels, 'ws.plan.', PLAN_KEYS),
    meters: keyed(labels, 'ws.meter.', METER_KEYS),
    units: keyed(labels, 'ws.unit.', UNIT_KEYS),
    evermind: t('ws.evermind', 'Evermind'),
    evermindVersion: t('ws.evermindVersion', 'v{version}'),
    evermindLearning: t('ws.evermindLearning', 'Learning'),
    evermindFrozen: t('ws.evermindFrozen', 'Not learning'),
    evermindAnswersOn: t('ws.evermindAnswersOn', 'Answers on'),
    evermindAnswersOff: t('ws.evermindAnswersOff', 'Answers off'),
    evermindHint: t('ws.evermindHint', 'Learning: this project’s chats teach its Evermind. Answers: whether the Evermind may answer for a paid model. Change both in the Evermind view.'),
  };
}

/** The spend pill + breakdown copy (the info strip above the chat, and the Status tab). */
export function spendLabelsFrom(labels: LabelBundle): Partial<SpendLabels> {
  const t = makeT(labels);
  return {
    spent: t('spend.spent', '{amount} spent'),
    saved: t('spend.saved', '{amount} saved'),
    savedApprox: t('spend.savedApprox', '≈{amount} saved'),
    tokens: t('spend.tokens', '{tokens} tok'),
    pillTitle: t('spend.pillTitle', 'What this conversation cost, and what memory saved'),
    spendHeading: t('spend.spendHeading', 'Spent'),
    platform: t('spend.platform', 'Builderforce plan'),
    yourKey: t('spend.yourKey', 'Your key'),
    yourKeyHint: t('spend.yourKeyHint', 'At the provider’s list price'),
    unpriced: t('spend.unpriced', '{tokens} tokens on unpriced models'),
    savedHeading: t('spend.savedHeading', 'Saved by memory'),
    savedShare: t('spend.savedShare', '{pct}% of the bill'),
    estimated: t('spend.estimated', 'estimate'),
    measured: t('spend.measured', 'recorded'),
    events: t('spend.events', '{count}×'),
    nothingSaved: t('spend.nothingSaved', 'Nothing saved yet'),
    periodHeading: t('spend.periodHeading', 'AI spend · last {days} days'),
    sources: keyed(labels, 'spend.source.', SAVING_SOURCES) as SpendLabels['sources'],
    sourceHints: keyed(labels, 'spend.sourceHint.', SAVING_SOURCES) as SpendLabels['sourceHints'],
  };
}

/** Everything `BrainComposer` reads, from the host bundle. Pure — memoize on its inputs. */
export function brainComposerLabels(
  labels: LabelBundle,
  modelLabels: ModelChoiceLabels | undefined,
  locale: string | undefined,
): BrainComposerLabels {
  const t = makeT(labels);
  return {
    composer: composerCopy(t, locale),
    options: promptMenuLabels(t, modelLabels),
    status: workStatusLabelsFrom(labels),
    spend: spendLabelsFrom(labels),
    mention: {
      title: t('app.mentionTitle', 'Direct to'),
      agent: t('app.mentionAgent', 'Agent'),
      human: t('app.mentionHuman', 'Person'),
    },
    ticket: {
      title: t('app.ticketTagTitle', 'Tag ticket'),
      status: t('app.ticketTagStatus', 'Status'),
      noMatches: t('app.ticketTagNoMatches', 'No tickets found'),
    },
  };
}
