'use client';

/**
 * "Ask a question" — the plain-English metric query, as a pinnable widget.
 *
 * It used to be a hard-coded panel on the /insights canvas, reachable from
 * exactly one page. It is the most portable thing on that page — a person who
 * keeps a board open wants to ask "how much are we spending this month?" from the
 * board, not by navigating away from it — so it is a {@link WidgetDef} like every
 * other card: pin it to your dashboard, drop it on a canvas, it works the same.
 *
 * Frameless: the WidgetCard chrome supplies the frame, title and pin. It owns its
 * own query state and never reads the dashboard's `days` window — the question
 * carries its own period ("this month", "last 30 days"), which is the whole point
 * of asking in words.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { WidgetMuted as Muted } from '@/components/widgets/widgetBody';
import type { WidgetDef } from '@/lib/widgets/types';
import { dashboardsApi, type QueryAnswer } from '@/lib/dashboardsApi';

const inputStyle: React.CSSProperties = {
  flex: '1 1 220px', minWidth: 0, padding: '8px 10px', borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)',
};

const btnStyle: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)',
  background: 'var(--bg-elevated)', color: 'var(--text-primary)', cursor: 'pointer',
  fontWeight: 600, fontSize: 'var(--font-size-small)', whiteSpace: 'nowrap',
};

/** Format an answer for display. One place decides, so the unit never drifts. */
function formatAnswer(answer: QueryAnswer): string {
  const { value, unit } = answer;
  if (value == null) return '—';
  if (unit === 'USD') return `$${Math.round(value).toLocaleString('en-US')}`;
  const rounded = Math.round(value * 100) / 100;
  if (unit === '%') return `${rounded}%`;
  if (unit === '/day') return `${rounded}/day`;
  if (unit === 'hours') return `${rounded}h`;
  return String(rounded);
}

function AskCard() {
  const t = useTranslations('dashboards');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<QueryAnswer | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    if (!question.trim()) return;
    setAsking(true);
    setAnswer(null);
    setError(null);
    try {
      setAnswer(await dashboardsApi.query(question.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAsking(false);
    }
  };

  return (
    // stopPropagation: this card is interactive, so a click inside it is never a
    // request to drill somewhere else.
    <div data-tour="demo-insights" onClick={(e) => e.stopPropagation()}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          style={inputStyle}
          placeholder={t('ask.placeholder')}
          aria-label={t('ask.heading')}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void ask(); }}
        />
        <button type="button" style={btnStyle} onClick={() => void ask()} disabled={asking}>
          {asking ? t('ask.asking') : t('ask.button')}
        </button>
      </div>

      {error && <div style={{ marginTop: 10 }}><Muted>{error}</Muted></div>}

      {answer && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--bg-base)' }}>
          {/* A question nothing recognised is announced BEFORE the number, not
              footnoted after it: the figure below is about the fallback metric,
              not about what was asked. */}
          {answer.source === 'default' && (
            <div role="status" style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-warning, var(--text-secondary))', marginBottom: 6 }}>
              {t('ask.notUnderstood')}
            </div>
          )}
          <div style={{ fontSize: 'var(--font-size-section)', fontWeight: 700, color: 'var(--text-primary)' }}>{formatAnswer(answer)}</div>
          <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', marginTop: 4 }}>{answer.explanation}</div>
          <div style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', marginTop: 4 }}>
            {t('ask.matched')}: <code>{answer.matchedMetric}</code>
            {answer.source === 'llm' && <> · {t('ask.viaModel')}</>}
          </div>
        </div>
      )}
    </div>
  );
}

export const ASK_WIDGETS: WidgetDef[] = [
  { id: 'overview.ask', group: 'overview', titleKey: 'overviewAsk', descKey: 'overviewAsk', size: 'lg', Card: AskCard },
];
