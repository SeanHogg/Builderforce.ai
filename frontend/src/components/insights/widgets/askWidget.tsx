'use client';

/**
 * "Ask a question" — the plain-English query, as a pinnable widget.
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
 *
 * ── WHY THE ANSWER IS A MINI-DASHBOARD ──────────────────────────────────────
 * The box used to render one number. That is the right answer to "how much are we
 * spending?" and no answer at all to "how are things looking?", which is what
 * people actually type into a box that invites a question — and those questions
 * came back as a dollar figure with a "not understood" note attached.
 *
 * The server now returns a COMPOSED answer for a question with no single-number
 * answer: a headline assembled from the figures it resolved, the readings behind
 * it, and the ids of the registry widgets that draw them. So this renders all
 * three, and the widgets come from the SAME registry (`getWidget`) every other
 * dashboard reads — a card looks and behaves identically whether it arrived by
 * being pinned or by being asked for.
 *
 * The "not understood" warning survives untouched, and still comes BEFORE the
 * numbers: a defaulted answer that looks like a match is the failure the `source`
 * field exists to prevent.
 */

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { WidgetMuted as Muted } from '@/components/widgets/widgetBody';
import type { WidgetDef } from '@/lib/widgets/types';
import { dashboardsApi, type ComposedAnswer, type QueryAnswer } from '@/lib/dashboardsApi';
import { useInsightFormat, type InsightFormatters } from '../format';

/**
 * THE REGISTRY EDGE IS ASYNC ON PURPOSE.
 *
 * This card is itself a registered widget, and the answer it renders contains
 * widgets FROM the registry. Imported statically that closes the loop
 * `allWidgets → askWidget → WidgetGrid → widgets/registry → allWidgets`, which is
 * a cycle of module EVALUATION, not merely of files: the module reached second
 * sees the first one's `const`s in their temporal dead zone and the page throws
 * `Cannot access 'X' before initialization` before React starts — no error
 * boundary, no partial render, a white page on every route that mounts the
 * registry. That exact loop has taken this app down once already.
 *
 * `dynamic(() => import(...))` is the fix rather than an exemption: an async edge
 * takes no part in module-evaluation order and so cannot form an initialization
 * loop. A grid that is only needed once somebody has asked a question wanted to be
 * lazy regardless.
 *
 * {@link WidgetGrid} is used unwrapped because it ALREADY skips ids it cannot
 * resolve — the behaviour that keeps a stale pin from breaking a dashboard also
 * keeps a widget retired between deploys from breaking an answer. A local filter
 * here would be a second copy of that rule.
 */
const WidgetGrid = dynamic(() => import('@/components/widgets/WidgetGrid').then((m) => m.WidgetGrid), { ssr: false });

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
function formatAnswer(f: InsightFormatters, answer: QueryAnswer): string {
  const { value, unit } = answer;
  if (value == null) return '—';
  if (unit === 'USD') return f.usd(Math.round(value));
  const rounded = Math.round(value * 100) / 100;
  if (unit === '%') return `${rounded}%`;
  if (unit === '/day') return `${rounded}/day`;
  if (unit === 'hours') return `${rounded}h`;
  return String(rounded);
}

/** One resolved reading: the figure, its label, and which whitelisted key produced it. */
function Reading({ answer }: { answer: QueryAnswer }) {
  const insight = useInsightFormat();
  return (
    <div style={{
      flex: '1 1 140px', minWidth: 0, padding: 10, borderRadius: 'var(--radius-md)',
      background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
    }}>
      <div style={{ fontSize: 'var(--font-size-section)', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.1 }}>
        {formatAnswer(insight, answer)}
      </div>
      <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', marginTop: 2, overflowWrap: 'anywhere' }}>
        {answer.label}
      </div>
    </div>
  );
}

/**
 * The composed answer body. Rendered for every answer, single-metric included —
 * a one-metric answer is just a composed answer with one reading, which is why
 * there is one renderer and not two that could drift apart.
 */
function Answer({ answer, days }: { answer: ComposedAnswer; days: number }) {
  const t = useTranslations('dashboards');
  const metrics = answer.metrics?.length ? answer.metrics : [answer];
  const widgetIds = answer.widgetIds ?? [];

  return (
    <div style={{ marginTop: 12, padding: 12, borderRadius: 'var(--radius-md)', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* A question nothing recognised is announced BEFORE the number, not
          footnoted after it: the figures below are about the fallback metric,
          not about what was asked. */}
      {answer.source === 'default' && (
        <div role="status" style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-warning, var(--text-secondary))' }}>
          {t('ask.notUnderstood')}
        </div>
      )}

      {answer.headline && (
        <div style={{ fontSize: 'var(--font-size-card-title)', fontWeight: 700, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>
          {answer.headline}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {metrics.map((m) => <Reading key={m.matchedMetric} answer={m} />)}
      </div>

      <div style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
        {answer.narrative || answer.explanation}
      </div>

      {widgetIds.length > 0 && (
        <div>
          <div style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', marginBottom: 8 }}>{t('ask.charts')}</div>
          {/* The SAME registry every dashboard renders from — an asked-for card and
              a pinned one are the same component, pin control included. */}
          <WidgetGrid ids={widgetIds} days={days} />
        </div>
      )}

      <div style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>
        {t('ask.matched')}: {metrics.map((m) => <code key={m.matchedMetric} style={{ marginRight: 6 }}>{m.matchedMetric}</code>)}
        {answer.source === 'llm' && <> · {t('ask.viaModel')}</>}
      </div>
    </div>
  );
}

function AskCard() {
  const t = useTranslations('dashboards');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<ComposedAnswer | null>(null);
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

      {/* The window the auto-chosen widgets render over is the one the QUESTION
          named ("this week", "last quarter"), which the server echoes back — not
          the dashboard's, which the question deliberately overrides. */}
      {answer && <Answer answer={answer} days={answer.days} />}
    </div>
  );
}

export const ASK_WIDGETS: WidgetDef[] = [
  { id: 'overview.ask', group: 'overview', titleKey: 'overviewAsk', descKey: 'overviewAsk', size: 'lg', Card: AskCard },
];
