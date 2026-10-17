/**
 * The conversation's spend, at a glance: "$0.42 · 1.2M tok · ≈$0.31 saved". Opens the
 * breakdown on click. Rides the chat object the surface already holds (`chat.spend`,
 * attached by the api to every chat payload) — it fetches nothing.
 *
 * Self-gating: renders nothing for a chat with no usage yet.
 */
import type { SpendSavingsSummary } from '@seanhogg/builderforce-brain-embedded';
import { usePopover } from '../popover/usePopover';
import { SpendBreakdown } from './SpendBreakdown';
import { fill, formatTokens, formatUsd } from './format';
import { spendLabels, type SpendLabels } from './labels';

export interface SpendPillProps {
  summary: SpendSavingsSummary | null | undefined;
  labels?: Partial<SpendLabels>;
  locale?: string;
}

/** Whether a conversation has anything to show yet — the pill's own visibility rule,
 *  exported so a host row that holds only the pill can fold away with it. */
export function hasSpendToShow(summary: SpendSavingsSummary | null | undefined): summary is SpendSavingsSummary {
  if (!summary) return false;
  const { spend, saved } = summary;
  return spend.totalTokens > 0 || spend.totalUsd > 0 || saved.bySource.length > 0;
}

export function SpendPill({ summary, labels: overrides, locale }: SpendPillProps) {
  const labels = spendLabels(overrides);
  const { open, toggle, rootRef } = usePopover<HTMLSpanElement>();
  if (!hasSpendToShow(summary)) return null;
  const { spend, saved } = summary;
  const anyEstimate = saved.bySource.some((s) => s.estimated);
  const savedText = saved.netUsd > 0
    ? fill(anyEstimate ? labels.savedApprox : labels.saved, { amount: formatUsd(saved.netUsd, locale) })
    : null;
  return (
    <span ref={rootRef} className="bf-spend-pill-wrap">
      <button
        type="button"
        className={`bf-spend-pill${open ? ' is-open' : ''}`}
        title={labels.pillTitle}
        aria-label={labels.pillTitle}
        aria-expanded={open}
        onClick={toggle}
      >
        <span className="bf-spend-pill__spent">{formatUsd(spend.totalUsd, locale)}</span>
        <span className="bf-spend-pill__sep" aria-hidden>·</span>
        <span className="bf-spend-pill__tok">{fill(labels.tokens, { tokens: formatTokens(spend.totalTokens, locale) })}</span>
        {savedText && (
          <>
            <span className="bf-spend-pill__sep" aria-hidden>·</span>
            <span className="bf-spend-pill__saved">{savedText}</span>
          </>
        )}
      </button>
      {open && (
        <div className="bf-spend-pill__pop" role="dialog" aria-label={labels.pillTitle}>
          <SpendBreakdown summary={summary} labels={labels} locale={locale} />
        </div>
      )}
    </span>
  );
}
