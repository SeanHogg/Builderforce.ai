/**
 * The copy of the spend & savings readouts — the chat's spend pill and the Status tab's
 * period card. Hosts pass their own localized bundle (next-intl on the web,
 * `vscode.l10n` in the editor, `chrome.i18n` in Rovr); the English defaults keep both
 * readable unmapped.
 *
 * Placeholders, substituted by the components: `{amount}` (a formatted dollar figure),
 * `{tokens}` (a formatted token count), `{pct}` (0–100), `{count}`, `{days}`.
 */
import type { SavingsSourceKey } from '@seanhogg/builderforce-brain-embedded';

export interface SpendLabels {
  /** Pill: "{amount} spent". */
  spent: string;
  /** Pill: "{amount} saved" — measured only. */
  saved: string;
  /** Pill: "≈{amount} saved" — when any part is an estimate. */
  savedApprox: string;
  /** Token count, e.g. "{tokens} tok". */
  tokens: string;
  /** Accessible name / title of the pill. */
  pillTitle: string;
  /** Breakdown heading: what the conversation cost. */
  spendHeading: string;
  platform: string;
  yourKey: string;
  /** Under "your key": priced at the provider's list price. */
  yourKeyHint: string;
  /** Tokens on models without a price, e.g. "{tokens} tokens on unpriced models". */
  unpriced: string;
  /** Breakdown heading: what memory saved. */
  savedHeading: string;
  /** Share of the would-be bill memory removed, e.g. "{pct}% of the bill". */
  savedShare: string;
  /** Marks an estimated row. */
  estimated: string;
  measured: string;
  /** Row count suffix, e.g. "{count}×". */
  events: string;
  /** Nothing saved yet. */
  nothingSaved: string;
  /** Status card heading, e.g. "AI spend · last {days} days". */
  periodHeading: string;
  /** One label per saving source. */
  sources: Record<SavingsSourceKey, string>;
  /** One explanation per saving source (tooltip). */
  sourceHints: Record<SavingsSourceKey, string>;
}

export const DEFAULT_SPEND_LABELS: SpendLabels = {
  spent: '{amount} spent',
  saved: '{amount} saved',
  savedApprox: '≈{amount} saved',
  tokens: '{tokens} tok',
  pillTitle: 'What this conversation cost, and what memory saved',
  spendHeading: 'Spent',
  platform: 'Builderforce plan',
  yourKey: 'Your key',
  yourKeyHint: 'At the provider’s list price',
  unpriced: '{tokens} tokens on unpriced models',
  savedHeading: 'Saved by memory',
  savedShare: '{pct}% of the bill',
  estimated: 'estimate',
  measured: 'recorded',
  events: '{count}×',
  nothingSaved: 'Nothing saved yet',
  periodHeading: 'AI spend · last {days} days',
  sources: {
    prompt_cache: 'Prompt cache',
    memory_answer: 'Answered from memory',
    evermind_answer: 'Answered by Evermind',
    response_cache: 'Repeated request',
    context_trim: 'Context kept lean',
    recall_overhead: 'Recall added',
  },
  sourceHints: {
    prompt_cache: 'The provider served part of the prompt from its cache at a tenth of the price',
    memory_answer: 'A question asked before was answered from memory — no model call',
    evermind_answer: 'The project’s Evermind answered — no paid model call',
    response_cache: 'An identical request was answered from the gateway cache — no model call',
    context_trim: 'Compaction kept earlier turns out of each call',
    recall_overhead: 'What recalled memories added to each prompt — the cost of recall',
  },
};

/** Merge a host's partial overrides over the English defaults (nested maps too). */
export function spendLabels(overrides?: Partial<SpendLabels>): SpendLabels {
  if (!overrides) return DEFAULT_SPEND_LABELS;
  return {
    ...DEFAULT_SPEND_LABELS,
    ...overrides,
    sources: { ...DEFAULT_SPEND_LABELS.sources, ...overrides.sources },
    sourceHints: { ...DEFAULT_SPEND_LABELS.sourceHints, ...overrides.sourceHints },
  };
}
