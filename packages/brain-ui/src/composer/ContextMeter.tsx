/**
 * The composer's context meter — how full the model's context was on the conversation's
 * last turn (`contextUsageOf`, brain-embedded), as a small ring and a percentage. With no
 * known window it shows the token count alone. The run auto-compacts older history on its
 * own, so this is a readout: its tooltip says so, and the transcript records each fold.
 */
import type { ContextUsage } from '@seanhogg/builderforce-brain-embedded';
import { fill, formatTokens } from '../spend/format';
import type { ComposerLabels } from './labels';

const R = 7;
const C = 2 * Math.PI * R;

export function ContextMeter({ usage, labels, locale }: {
  usage: ContextUsage | null | undefined;
  labels: Pick<ComposerLabels, 'contextMeterHint' | 'contextMeterHintTokens'>;
  locale?: string;
}) {
  if (!usage) return null;
  const used = formatTokens(usage.promptTokens, locale);
  const window = usage.contextWindow;
  if (!window) {
    const hint = fill(labels.contextMeterHintTokens, { used });
    return (
      <span className="bf-ctx-meter" title={hint} aria-label={hint} role="note">
        <span className="bf-ctx-meter__text">{used}</span>
      </span>
    );
  }
  const percent = Math.min(100, Math.round((usage.promptTokens / window) * 100));
  // The reader's own percent format ("22%", "22 %").
  const shown = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(percent / 100);
  const hint = fill(labels.contextMeterHint, { used, limit: formatTokens(window, locale), percent: shown });
  const tone = percent >= 90 ? ' bf-ctx-meter--full' : percent >= 70 ? ' bf-ctx-meter--high' : '';
  return (
    <span
      className={`bf-ctx-meter${tone}`}
      title={hint}
      role="meter"
      aria-label={hint}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <svg className="bf-ctx-meter__ring" width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
        <circle className="bf-ctx-meter__track" cx="9" cy="9" r={R} fill="none" strokeWidth="2.5" />
        <circle
          className="bf-ctx-meter__fill"
          cx="9"
          cy="9"
          r={R}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={`${(percent / 100) * C} ${C}`}
          transform="rotate(-90 9 9)"
        />
      </svg>
      <span className="bf-ctx-meter__text">{shown}</span>
    </span>
  );
}
