'use client';

import type { CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import type { ToolResult } from '@/lib/tools';

/**
 * Generic result renderer for any diagnostic tool (calculator or questionnaire).
 * One layout for the whole suite, so no tool re-implements score/plan display.
 * Tool content (metric labels, recommendations) is backend data; only the
 * chrome headings are localized.
 */

const TIER_COLOR = ['#ef4444', '#f59e0b', '#eab308', '#3b82f6', '#22c55e'];

const card: CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 16,
};

function TierMeter({ tier }: { tier?: number }) {
  if (tier == null) return null;
  return (
    <div style={{ display: 'flex', gap: 3 }} aria-hidden>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} style={{ width: 16, height: 7, borderRadius: 3, background: n <= tier ? TIER_COLOR[Math.min(tier, 5) - 1] : 'var(--border-subtle)' }} />
      ))}
    </div>
  );
}

export function ToolResultView({ result }: { result: ToolResult }) {
  const t = useTranslations('tools');
  const score = result.score;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Headline */}
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 18 }}>
        {score != null && (
          <div style={{ textAlign: 'center', minWidth: 90 }}>
            <div style={{ fontSize: 38, fontWeight: 800, lineHeight: 1, color: TIER_COLOR[Math.max(1, Math.min(5, Math.round(score))) - 1] }}>
              {score.toFixed(1)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{t('outOf5')}</div>
          </div>
        )}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-strong)' }}>{result.headline}</div>
          {result.summary && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>{result.summary}</div>}
        </div>
      </div>

      {/* Metrics */}
      {result.metrics.length > 0 && (
        <div style={card}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-strong)', margin: '0 0 12px' }}>{t('breakdown')}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {result.metrics.map((m) => (
              <div key={m.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{m.label}</div>
                  {m.hint && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{m.hint}</div>}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-strong)', whiteSpace: 'nowrap' }}>{m.value}</div>
                <TierMeter tier={m.tier} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {result.recommendations.length > 0 && (
        <div style={card}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-strong)', margin: '0 0 4px' }}>{t('planTitle')}</h3>
          <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 12px' }}>{t('planSubtitle')}</p>
          <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {result.recommendations.map((r, i) => (
              <li key={i} style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                <strong>{r.title}</strong>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>{r.detail}</div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
