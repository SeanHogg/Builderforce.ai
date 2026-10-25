/**
 * The host bundle → the shared composer's copy — the prompt box, its `+` menu and
 * trailing button, the `/` Work panel (Mode, Effort, Model), its Status tab (plan,
 * meters, Evermind), the spend & savings readouts and the @/# pickers.
 *
 * The host translates every string through `vscode.l10n` (see `brainChatLabels.ts`
 * and `src/workStatusLabels.ts`). The key tables and the English defaults are
 * brain-ui's (`brainComposerLabelsFrom`, `spendLabelsFrom`); this file only says where
 * each canonical key lives in the editor's bundle. Figures are formatted for the
 * editor's locale before the bundle's `{placeholder}` is filled.
 */

import {
  brainComposerLabelsFrom,
  bundleLookup,
  spendLabelsFrom as sharedSpendLabelsFrom,
  type BrainComposerLabels,
  type ModelChoiceLabels,
  type SpendLabels,
} from '@seanhogg/builderforce-brain-ui';
import type { LabelBundle } from '../vscodeBridge';
import { optionBundleKey } from './chatLabels';

/** Composer keys whose bundle key is not `app.<key>`. */
const COMPOSER_KEY: Readonly<Record<string, string>> = {
  upload: 'app.uploadFile',
  'modeLabel.chat': 'app.modeChat',
  'modeLabel.work': 'app.modeWork',
  'modeHint.chat': 'app.modeChatHint',
  'modeHint.work': 'app.modeWorkHint',
  effortThinkingSuffix: 'app.effortDescThinking',
};

/** Status-tab fields the bundle carries under `app.` (the rest are `ws.`). */
const STATUS_APP_KEY: Readonly<Record<string, string>> = {
  loading: 'app.statusLoading',
  account: 'app.account',
  plan: 'app.plan',
  resets: 'app.resets',
  usage: 'app.usage',
  usageEmpty: 'app.usageEmpty',
  unlimited: 'app.unlimited',
  upgrade: 'app.upgrade',
  managePlan: 'app.managePlan',
};

/** The Status tab's keyed records → the bundle's (singular) prefixes. */
const STATUS_RECORD_PREFIX: Readonly<Record<string, string>> = {
  billing: 'ws.billing.',
  plans: 'ws.plan.',
  meters: 'ws.meter.',
  units: 'ws.unit.',
};

const MENTION_KEY: Readonly<Record<string, string>> = {
  'mention.title': 'app.mentionTitle',
  'mention.agent': 'app.mentionAgent',
  'mention.human': 'app.mentionHuman',
  'ticket.title': 'app.ticketTagTitle',
  'ticket.status': 'app.ticketTagStatus',
  'ticket.noMatches': 'app.ticketTagNoMatches',
};

function statusKey(key: string): string {
  const dot = key.indexOf('.');
  if (dot > 0) return `${STATUS_RECORD_PREFIX[key.slice(0, dot)] ?? 'ws.'}${key.slice(dot + 1)}`;
  return STATUS_APP_KEY[key] ?? `ws.${key}`;
}

function spendKey(key: string): string {
  if (key.startsWith('sources.')) return `spend.source.${key.slice('sources.'.length)}`;
  if (key.startsWith('sourceHints.')) return `spend.sourceHint.${key.slice('sourceHints.'.length)}`;
  return `spend.${key}`;
}

/** Where a scoped canonical key (`composer.add`, `status.meters.ai_tokens` …) lives in the bundle. */
function bundleKeyOf(scoped: string): string | undefined {
  const dot = scoped.indexOf('.');
  const part = scoped.slice(0, dot);
  const key = scoped.slice(dot + 1);
  switch (part) {
    case 'composer': return COMPOSER_KEY[key] ?? `app.${key}`;
    case 'options': return optionBundleKey(key);
    case 'status': return statusKey(key);
    case 'spend': return spendKey(key);
    case 'connections': return `conn.${key}`;
    default: return MENTION_KEY[scoped];
  }
}

/** The spend pill + breakdown copy (the info strip above the chat, and the Status tab). */
export function spendLabelsFrom(labels: LabelBundle): SpendLabels {
  return sharedSpendLabelsFrom(bundleLookup(labels, spendKey));
}

/**
 * Everything `BrainComposer` reads, from the host bundle. Pure — memoize on its inputs.
 * The model rows' copy comes from `init.modelLabels` — the SAME object the host's
 * `Change model` QuickPick renders from — under the bundle's own menu chrome.
 */
export function brainComposerLabels(
  labels: LabelBundle,
  modelLabels: ModelChoiceLabels | undefined,
  locale: string | undefined,
): BrainComposerLabels {
  const fromBundle = bundleLookup(labels, bundleKeyOf, (v) => v.toLocaleString(locale));
  const rows = (modelLabels ?? {}) as Partial<Record<string, string>>;
  return brainComposerLabelsFrom((key, values) =>
    fromBundle(key, values) || (key.startsWith('options.') ? rows[key.slice('options.'.length)] : undefined));
}
