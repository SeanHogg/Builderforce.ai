/**
 * The breakdown behind a spend figure — what was spent (Builderforce plan vs your own
 * key at list price) and what memory saved, source by source, with every estimated row
 * marked as one. Presentational; shared by the chat's spend pill and the Status card.
 */
import type { SpendSavingsSummary } from '@seanhogg/builderforce-brain-embedded';
import { fill, formatPct, formatTokens, formatUsd } from './format';
import type { SpendLabels } from './labels';

export interface SpendBreakdownProps {
  summary: SpendSavingsSummary;
  labels: SpendLabels;
  locale?: string;
}

export function SpendBreakdown({ summary, labels, locale }: SpendBreakdownProps) {
  const { spend, saved, savedPct } = summary;
  const usd = (n: number) => formatUsd(n, locale);
  return (
    <div className="bf-spend">
      <div className="bf-spend__group">{labels.spendHeading}</div>
      <div className="bf-spend__row">
        <span className="bf-spend__k">{labels.platform}</span>
        <span className="bf-spend__v">{usd(spend.platformUsd)}</span>
      </div>
      {spend.yourKeyUsd > 0 && (
        <div className="bf-spend__row" title={labels.yourKeyHint}>
          <span className="bf-spend__k">{labels.yourKey}</span>
          <span className="bf-spend__v">{usd(spend.yourKeyUsd)}</span>
        </div>
      )}
      <div className="bf-spend__meta">
        {fill(labels.tokens, { tokens: formatTokens(spend.totalTokens, locale) })}
        {spend.unpricedTokens > 0 && ` · ${fill(labels.unpriced, { tokens: formatTokens(spend.unpricedTokens, locale) })}`}
      </div>

      <div className="bf-spend__group">
        {labels.savedHeading}
        {savedPct != null && savedPct > 0 && (
          <span className="bf-spend__share">{fill(labels.savedShare, { pct: formatPct(savedPct) })}</span>
        )}
      </div>
      {saved.bySource.length === 0 && <div className="bf-spend__meta">{labels.nothingSaved}</div>}
      {saved.bySource.map((row) => (
        <div key={`${row.source}:${row.estimated ? 'e' : 'm'}`} className="bf-spend__row" title={labels.sourceHints[row.source]}>
          <span className="bf-spend__k">
            {labels.sources[row.source]}
            {row.events > 0 && <span className="bf-spend__count">{fill(labels.events, { count: String(row.events) })}</span>}
          </span>
          <span className={`bf-spend__v${row.usd < 0 ? ' bf-spend__v--cost' : ' bf-spend__v--saved'}`}>
            {row.estimated ? '≈' : ''}{usd(row.usd)}
          </span>
        </div>
      ))}
      {saved.bySource.length > 0 && (
        <div className="bf-spend__meta">
          {saved.measuredUsd !== 0 && `${labels.measured} ${usd(saved.measuredUsd)}`}
          {saved.measuredUsd !== 0 && saved.estimatedUsd !== 0 && ' · '}
          {saved.estimatedUsd !== 0 && `${labels.estimated} ≈${usd(saved.estimatedUsd)}`}
        </div>
      )}
    </div>
  );
}
