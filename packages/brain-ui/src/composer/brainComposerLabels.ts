/**
 * Everything `BrainComposer` renders — the box, the `/` menu, its Status tab, the spend
 * readouts and the @/# pickers — from ONE host lookup, through each part's own key
 * table. Canonical keys are scoped by part: `composer.<key>`, `options.<key>`,
 * `status.<key>`, `spend.<key>`, `mention.<key>` and `ticket.<key>`, each `<key>` being
 * that part's own canonical key (see `composerLabelsFrom`, `promptOptionsLabelsFrom`,
 * `workStatusLabelsFrom`, `spendLabelsFrom`). Every host — the web (next-intl), the
 * editor webview (`vscode.l10n` bundle) and Rovr (`chrome.i18n`) — builds its composer
 * copy here and only maps those keys onto its own catalog.
 */
import type { LabelLookup } from '../labelCatalog';
import { stringsFrom } from '../labelCatalog';
import type { MentionLabels } from '../mention/MentionAutocomplete';
import type { TicketAutocompleteLabels } from '../mention/TicketAutocomplete';
import { promptOptionsLabelsFrom, type PromptOptionsLabels } from '../promptOptions/types';
import { spendLabelsFrom, type SpendLabels } from '../spend/labels';
import { workStatusLabelsFrom, type WorkStatusLabels } from '../workStatus/labels';
import { composerLabelsFrom, type ComposerLabels } from './labels';

export const DEFAULT_MENTION_LABELS: Required<MentionLabels> = { title: 'Direct to', agent: 'Agent', human: 'Person' };
export const DEFAULT_TICKET_TAG_LABELS: Required<TicketAutocompleteLabels> = { title: 'Tag ticket', status: 'Status', noMatches: 'No tickets found' };

/** The lookup one part reads: its own canonical keys, under `<part>.` in the host's. */
export function scopedLookup(lookup: LabelLookup, part: string): LabelLookup {
  return (key, values) => lookup(`${part}.${key}`, values);
}

export interface FullBrainComposerLabels {
  composer: ComposerLabels;
  options: PromptOptionsLabels;
  status: WorkStatusLabels;
  spend: SpendLabels;
  mention: Required<MentionLabels>;
  ticket: Required<TicketAutocompleteLabels>;
}

/** `overrides`: copy a host words from another source on purpose (e.g. the web's
 *  chat-mode vocabulary for `composer.modeLabel`). */
export function brainComposerLabelsFrom(
  lookup: LabelLookup,
  overrides?: { composer?: Partial<ComposerLabels>; options?: Partial<PromptOptionsLabels> },
): FullBrainComposerLabels {
  return {
    composer: composerLabelsFrom(scopedLookup(lookup, 'composer'), overrides?.composer),
    options: { ...promptOptionsLabelsFrom(scopedLookup(lookup, 'options')), ...overrides?.options },
    status: workStatusLabelsFrom(scopedLookup(lookup, 'status')),
    spend: spendLabelsFrom(scopedLookup(lookup, 'spend')),
    mention: stringsFrom(DEFAULT_MENTION_LABELS, scopedLookup(lookup, 'mention')),
    ticket: stringsFrom(DEFAULT_TICKET_TAG_LABELS, scopedLookup(lookup, 'ticket')),
  };
}
