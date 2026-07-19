'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { pulseApi, type PulseActive, type PulseSurveySummary, type PulseTrendPoint } from '@/lib/pulseApi';
import { usePmData } from '@/lib/pm/usePmData';
import { PmCard, PmEmpty, PmError, StatCard } from '@/components/pm/pmShared';
import { Sparkline } from '@/components/charts/Sparkline';
import { colorAt } from '@/components/charts/chartColors';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';

const btnStyle: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
  background: 'var(--accent, #7c5cff)', color: '#fff', fontWeight: 600, fontSize: '0.85rem',
};
const chipStyle = (active: boolean): React.CSSProperties => ({
  width: 40, height: 40, borderRadius: 8, cursor: 'pointer', fontWeight: 700,
  border: active ? '2px solid var(--accent, #7c5cff)' : '1px solid var(--border-subtle)',
  background: active ? 'rgba(124,92,255,0.14)' : 'var(--bg-base)',
  color: 'var(--text-primary)',
});

/**
 * Member-facing pulse submit card (EMP-15). Shows the open survey, a 1..scale score
 * picker and an optional comment. Anonymous — the member only learns whether they
 * have already answered. Renders nothing when there is no open survey.
 */
export function PulseSubmitCard() {
  const t = useTranslations('insights.emp');
  const { data, error, reload } = usePmData<PulseActive>(() => pulseApi.active(), []);
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  if (error) return <PmError message={error} />;
  if (!data) return null;
  if (!data.survey) return null;

  if (data.hasResponded || done) {
    return (
      <PmCard title={t('pulse.title')}>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{t('pulse.thanks')}</p>
      </PmCard>
    );
  }

  const survey = data.survey;
  const submit = async () => {
    if (score == null) return;
    setSaving(true);
    try {
      await pulseApi.respond(survey.id, score, comment.trim() || undefined);
      setDone(true);
      reload();
    } finally {
      setSaving(false);
    }
  };

  return (
    <PmCard title={t('pulse.title')}>
      <p style={{ fontWeight: 600, marginBottom: 12 }}>{survey.question}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {Array.from({ length: survey.scale }, (_, i) => i + 1).map((n) => (
          <button key={n} type="button" style={chipStyle(score === n)} onClick={() => setScore(n)} aria-pressed={score === n}>
            {n}
          </button>
        ))}
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder={t('pulse.commentPlaceholder')}
        rows={2}
        style={{ width: '100%', padding: 8, borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: '0.85rem', marginBottom: 12 }}
      />
      <button type="button" style={{ ...btnStyle, opacity: score == null || saving ? 0.6 : 1 }} disabled={score == null || saving} onClick={submit}>
        {t('pulse.submit')}
      </button>
    </PmCard>
  );
}

/**
 * Manager pulse lens (EMP-15). Create/close surveys and read the anonymous
 * aggregate + cross-survey sentiment trend. Never shows a per-user score.
 */
export function PulseLens() {
  const t = useTranslations('insights.emp');
  const [tick, setTick] = useState(0);
  const [question, setQuestion] = useState('');
  const [scale, setScale] = useState(5);
  const [busy, setBusy] = useState(false);

  const surveys = usePmData<{ surveys: PulseSurveySummary[] }>(() => pulseApi.list(), [tick]);
  const trend = usePmData<{ trend: PulseTrendPoint[] }>(() => pulseApi.trend(), [tick]);

  if (surveys.error) return <PmError message={surveys.error} />;
  if (!surveys.data) return <PmEmpty message={t('loading')} />;

  const create = async () => {
    if (!question.trim()) return;
    setBusy(true);
    try {
      await pulseApi.create(question.trim(), scale);
      setQuestion('');
      setTick((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };
  const close = async (id: string) => {
    setBusy(true);
    try { await pulseApi.close(id); setTick((n) => n + 1); } finally { setBusy(false); }
  };

  const trendValues = (trend.data?.trend ?? []).map((p) => p.averageScore ?? 0);
  const latest = trend.data?.trend?.[trend.data.trend.length - 1];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <StatCard label={t('pulse.latestAvg')} value={latest?.averageScore != null ? latest.averageScore.toFixed(1) : '—'} />
        <StatCard label={t('pulse.latestEnps')} value={latest?.enps != null ? String(latest.enps) : '—'} />
        <StatCard
          label={t('pulse.trend')}
          value={latest?.responseCount != null ? String(latest.responseCount) : '—'}
          sub={t('pulse.responses')}
          chart={trendValues.length > 1 ? <Sparkline values={trendValues} width={140} height={30} color={colorAt(0)} ariaLabel={t('pulse.trend')} /> : undefined}
        />
      </div>

      <PmCard title={t('pulse.create')}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={t('pulse.questionPlaceholder')}
            style={{ flex: '1 1 240px', padding: 8, borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: '0.85rem' }}
          />
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
            {t('pulse.scale')}
            <input type="number" min={2} max={10} value={scale} onChange={(e) => setScale(Number(e.target.value))} style={{ width: 64, padding: 8, borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'var(--bg-base)', color: 'var(--text-primary)' }} />
          </label>
          <button type="button" style={{ ...btnStyle, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={create}>{t('pulse.open')}</button>
        </div>
      </PmCard>

      <PmCard title={t('pulse.surveys')}>
        {surveys.data.surveys.length === 0 ? (
          <PmEmpty message={t('pulse.noSurveys')} />
        ) : (
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr style={theadRowStyle}>
                  <th style={thStyle}>{t('pulse.question')}</th>
                  <th style={thStyle}>{t('pulse.responses')}</th>
                  <th style={thStyle}>{t('pulse.average')}</th>
                  <th style={thStyle}>{t('pulse.enps')}</th>
                  <th style={thStyle}>{t('pulse.status')}</th>
                  <th style={thStyle} />
                </tr>
              </thead>
              <tbody>
                {surveys.data.surveys.map((s) => (
                  <tr key={s.id} style={trStyle}>
                    <td style={tdStyle}>{s.question}</td>
                    <td style={tdMutedStyle}>{s.responseCount}</td>
                    <td style={tdMutedStyle}>{s.averageScore != null ? s.averageScore.toFixed(1) : '—'}</td>
                    <td style={tdMutedStyle}>{s.enps != null ? s.enps : '—'}</td>
                    <td style={tdMutedStyle}>{s.active ? t('pulse.active') : t('pulse.closed')}</td>
                    <td style={tdMutedStyle}>
                      {s.active && (
                        <button type="button" onClick={() => close(s.id)} disabled={busy} style={{ background: 'none', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
                          {t('pulse.close')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PmCard>
    </div>
  );
}
