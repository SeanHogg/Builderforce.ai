/**
 * The chat-tickets rail's labels from a host's flat string bundle (`ct.*` keys → text,
 * `{name}` placeholders in the parametric ones) — the same shape as the Evermind
 * console's `evermindLabelsFromBundle`. The VS Code extension translates through
 * `vscode.l10n` and hands its bundle here; a key the bundle lacks keeps the English
 * default, so a host that ships part of the catalog still renders every control.
 *
 * Keys: `ct.<field>` for every static field of {@link ChatTicketsLabels}, `ct.kind.<kind>`
 * for the tier names, and these templates for the parametric ones —
 * `ct.ringAria` ({label}, {pct}), `ct.inParent` ({parent}), `ct.ticketCountOne` /
 * `ct.ticketCountMany` ({n}), `ct.overallAria` ({pct}), `ct.runStarted` ({agent}),
 * `ct.mergeAction` ({n}), `ct.mergedN` ({n}).
 */
import { fill } from '../spend/format';
import { DEFAULT_CHAT_TICKETS_LABELS, type ChatTicketsLabels, type TicketKind } from './types';

export function chatTicketsLabelsFromBundle(bundle: Readonly<Record<string, string>>, prefix = 'ct.'): ChatTicketsLabels {
  const d = DEFAULT_CHAT_TICKETS_LABELS;
  const s = (key: string): string | undefined => bundle[`${prefix}${key}`] || undefined;
  const out: Record<string, unknown> = { ...d };
  for (const [key, fallback] of Object.entries(d)) {
    if (typeof fallback === 'string') out[key] = s(key) ?? fallback;
  }
  const kind = { ...d.kind };
  for (const k of Object.keys(kind) as TicketKind[]) kind[k] = s(`kind.${k}`) ?? kind[k];
  /** A parametric label: the bundle's template, or the English default function. */
  const tpl = <A extends unknown[]>(key: string, fallback: (...args: A) => string, vars: (...args: A) => Record<string, string | number>) => {
    const template = s(key);
    return template ? (...args: A) => fill(template, vars(...args)) : fallback;
  };
  const one = s('ticketCountOne');
  const many = s('ticketCountMany');
  return {
    ...(out as unknown as ChatTicketsLabels),
    kind,
    ringAria: tpl('ringAria', d.ringAria, (label: string, pct: number) => ({ label, pct })),
    inParent: tpl('inParent', d.inParent, (parent: string) => ({ parent })),
    ticketCount: one && many ? (n) => fill(n === 1 ? one : many, { n }) : d.ticketCount,
    overallAria: tpl('overallAria', d.overallAria, (pct: number) => ({ pct })),
    runStarted: tpl('runStarted', d.runStarted, (agent: string) => ({ agent })),
    mergeAction: tpl('mergeAction', d.mergeAction, (n: number) => ({ n })),
    mergedN: tpl('mergedN', d.mergedN, (n: number) => ({ n })),
  };
}
