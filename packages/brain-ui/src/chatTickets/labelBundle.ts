/**
 * The chat-tickets rail's labels from a host catalog — the ONE key table every host
 * reads it through. Canonical keys: `<field>` for every static field of
 * {@link ChatTicketsLabels}, `kind.<kind>` for the tier names, and these parametric
 * ones (their figures as `values`) — `ringAria` ({label}, {pct}), `inParent` ({parent}),
 * `ticketCountOne` / `ticketCountMany` ({n}), `overallAria` ({pct}), `runStarted`
 * ({agent}), `mergeAction` ({n}), `mergedN` ({n}). A key the catalog lacks keeps the
 * English default, so a host that ships part of the catalog still renders every control.
 */
import { bundleLookup, stringsFrom, type LabelLookup, type LabelValues } from '../labelCatalog';
import { DEFAULT_CHAT_TICKETS_LABELS, type ChatTicketsLabels } from './types';

export function chatTicketsLabelsFrom(lookup: LabelLookup): ChatTicketsLabels {
  const d = DEFAULT_CHAT_TICKETS_LABELS;
  /** A parametric label: the catalog's rendering, or the English default function. */
  const tpl = <A extends unknown[]>(key: string, fallback: (...args: A) => string, vars: (...args: A) => LabelValues) =>
    (...args: A) => lookup(key, vars(...args)) || fallback(...args);
  return {
    ...stringsFrom(d, lookup),
    kind: stringsFrom(d.kind, lookup, 'kind.'),
    ringAria: tpl('ringAria', d.ringAria, (label: string, pct: number) => ({ label, pct })),
    inParent: tpl('inParent', d.inParent, (parent: string) => ({ parent })),
    ticketCount: (n) => lookup(n === 1 ? 'ticketCountOne' : 'ticketCountMany', { n }) || d.ticketCount(n),
    overallAria: tpl('overallAria', d.overallAria, (pct: number) => ({ pct })),
    runStarted: tpl('runStarted', d.runStarted, (agent: string) => ({ agent })),
    mergeAction: tpl('mergeAction', d.mergeAction, (n: number) => ({ n })),
    mergedN: tpl('mergedN', d.mergedN, (n: number) => ({ n })),
  };
}

/**
 * The same table over a host's FLAT bundle (`ct.*` keys → text, `{name}` placeholders) —
 * the shape the VS Code extension posts (and the Evermind console's
 * `evermindLabelsFromBundle` reads).
 */
export function chatTicketsLabelsFromBundle(bundle: Readonly<Record<string, string>>, prefix = 'ct.'): ChatTicketsLabels {
  return chatTicketsLabelsFrom(bundleLookup(bundle, (key) => `${prefix}${key}`));
}
