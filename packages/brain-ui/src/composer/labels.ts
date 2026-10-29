/**
 * The copy of the shared composer — the prompt box, its `+` menu, its trailing button,
 * and the descriptions the `/` menu's rows state their REAL effect with. Hosts pass a
 * localized bundle (next-intl on the web, `vscode.l10n` in the editor, `chrome.i18n` in
 * Rovr); English defaults keep it usable unmapped.
 *
 * Parameterised copy is a FUNCTION, not a template: each host's i18n formats numbers
 * its own way (ICU plurals on the web, `{0}` in the editor), so the host renders the
 * sentence and the composer supplies the figure.
 */
import type { ChatMode, Effort } from '@seanhogg/builderforce-brain-embedded';
import { stringsFrom, type LabelLookup } from '../labelCatalog';

export interface ComposerLabels {
  placeholder: string;
  add: string;
  upload: string;
  uploading: string;
  addContext: string;
  browseWeb: string;
  on: string;
  off: string;
  remove: string;
  send: string;
  /** Send while a run streams queues the message behind it — its name says so. (A host
   *  whose Send STEERS the run words it so; its queue is then {@link queueAfter}.) */
  queueSend: string;
  /** Send while a run streams when the message will be HELD for after it (a participant, a file a steer
   *  would drop, turns already waiting, a run being stopped) - read when the host says Send does not steer. */
  queueHold: string;
  /** The "Queue for after" button beside Send mid-run — `keys` is the platform's
   *  shortcut (`Alt+Enter`, `⌥+Enter` on macOS). */
  queueAfter: (keys: string) => string;
  /** Its short visible text (hidden at narrow widths, where the icon stands alone). */
  queueAfterShort: string;
  stop: string;
  dictate: string;
  stopDictation: string;
  /** Chat | Work, and what each one does. */
  modeLabel: (mode: ChatMode) => string;
  modeHint: (mode: ChatMode) => string;
  memoryOnHint: string;
  memoryOffHint: string;
  /** Why the Memory switch gates nothing (no project behind the chat). */
  memoryUnavailable: string;
  autoModeHint: string;
  /** What an Effort level really costs — its answer budget. */
  effortDesc: (level: Effort, answerTokens: number) => string;
  /** Appended to an Effort description while Thinking is on. */
  effortThinkingSuffix: (thinkingTokens: number) => string;
  thinkingOnDesc: (budgetTokens: number) => string;
  thinkingOffDesc: string;
  /** The context meter's tooltip when the model's window is known — `{used}`, `{limit}`
   *  (tokens) and `{percent}` (with its sign), all formatted by the meter. */
  contextMeterHint: string;
  /** …and when it is not — `{used}` only. */
  contextMeterHintTokens: string;
}

const n = (v: number) => v.toLocaleString();

export const DEFAULT_COMPOSER_LABELS: ComposerLabels = {
  placeholder: 'Message…',
  add: 'Add',
  upload: 'Upload from computer',
  uploading: 'Uploading…',
  addContext: 'Add context',
  browseWeb: 'Browse the web',
  on: 'On',
  off: 'Off',
  remove: 'Remove',
  send: 'Send',
  queueSend: 'Queue message — sends when the current run finishes',
  queueHold: 'Queue message — sends when the current run finishes',
  queueAfter: (keys) => `Queue for after the run (${keys})`,
  queueAfterShort: 'Queue',
  stop: 'Stop',
  dictate: 'Dictate',
  stopDictation: 'Stop dictation',
  modeLabel: (mode) => (mode === 'work' ? 'Work' : 'Chat'),
  modeHint: (mode) => (mode === 'work'
    ? 'Turn what we agree into tracked work — open the ticket, staff it, and dispatch an agent to run it'
    : 'Just answer — read and reason as much as needed, but do not open or dispatch board work'),
  memoryOnHint: 'Memory on — this chat recalls and learns from the project memory',
  memoryOffHint: 'Memory off — this chat is a scratch space (no recall, no learning)',
  memoryUnavailable: 'This chat has no project memory to recall from — link it to a project first',
  autoModeHint: 'Auto-approve tool actions without asking',
  effortDesc: (level, answer) => ({
    quick: `Fastest and cheapest — short, direct answers. Up to ${n(answer)} answer tokens.`,
    balanced: `The default — normal depth. Up to ${n(answer)} answer tokens.`,
    thorough: `Deepest and slowest — exhaustive, verifies its work. Up to ${n(answer)} answer tokens.`,
  })[level],
  effortThinkingSuffix: (thinking) => `Plus up to ${n(thinking)} thinking tokens.`,
  thinkingOnDesc: (budget) => `The model reasons before answering, with a ${n(budget)}-token thinking budget at this effort. Slower, better on hard problems.`,
  thinkingOffDesc: 'Off — the model answers directly. Turn on for a reasoning pass before the answer.',
  contextMeterHint: 'Context: {used} of {limit} tokens on the last turn ({percent}). Older history is auto-compacted as it fills.',
  contextMeterHintTokens: 'Context: {used} tokens on the last turn. Older history is auto-compacted as it fills.',
};

export function composerLabels(overrides?: Partial<ComposerLabels>): ComposerLabels {
  return overrides ? { ...DEFAULT_COMPOSER_LABELS, ...overrides } : DEFAULT_COMPOSER_LABELS;
}

/**
 * THE composer copy from a host catalog — the ONE key table every host reads it
 * through. Canonical keys are the field names; the per-choice ones are
 * `modeLabel.<mode>`, `modeHint.<mode>` and `effortDesc.<level>` (figure `answer`),
 * plus `effortThinkingSuffix` (`thinking`) and `thinkingOnDesc` (`budget`). A key the
 * catalog lacks keeps the English default. `overrides` is for copy a host words from
 * another source on purpose (the web's chat-mode vocabulary).
 */
export function composerLabelsFrom(lookup: LabelLookup, overrides?: Partial<ComposerLabels>): ComposerLabels {
  const d = DEFAULT_COMPOSER_LABELS;
  return {
    ...stringsFrom(d, lookup),
    queueAfter: (keys) => lookup('queueAfter', { keys }) || d.queueAfter(keys),
    modeLabel: (mode) => lookup(`modeLabel.${mode}`) || d.modeLabel(mode),
    modeHint: (mode) => lookup(`modeHint.${mode}`) || d.modeHint(mode),
    effortDesc: (level, answer) => lookup(`effortDesc.${level}`, { answer }) || d.effortDesc(level, answer),
    effortThinkingSuffix: (thinking) => lookup('effortThinkingSuffix', { thinking }) || d.effortThinkingSuffix(thinking),
    thinkingOnDesc: (budget) => lookup('thinkingOnDesc', { budget }) || d.thinkingOnDesc(budget),
    ...overrides,
  };
}
