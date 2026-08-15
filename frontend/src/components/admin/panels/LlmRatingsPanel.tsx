'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { adminApi, type LlmRatingBucket, type LlmRatingSummary } from '@/lib/adminApi';
import { AdminError, AdminLoading, AdminPanelHeader, fmtNum, useAdminData } from '@/components/admin/adminShared';

/**
 * WHICH MODEL IS ACTUALLY GOOD AT WHICH KIND OF WORK — read off what humans said.
 *
 * The sibling of the Usage panel next door. That one answers "what did we spend and
 * where"; a cost table alone will happily recommend the cheapest model in the pool
 * even when every person who read its output pressed 👎. This panel is the other
 * half of that decision, built from `llm_action_ratings` (migration 0468): every
 * thumb pressed in the Brain panel, the Creation Canvas or the VS Code webview,
 * filed against the model that served the turn and the MCP tool it executed.
 *
 * It leads with VERDICTS rather than rows, because the actionable finding is a
 * comparison ("for canvas_add_object, model A beats model B") and a raw table makes
 * the reader do that comparison by eye. The full breakdown follows underneath.
 *
 * The same numbers feed the learned router (`blendedQualityScore`), so this page is
 * a window onto routing behaviour, not a separate opinion about it.
 */

const card: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  padding: 16,
};

/** Satisfaction as a percentage of the smoothed score, for display only. */
function pct(score: number): string {
  return `${Math.round(score * 100)}%`;
}

/** Green above neutral, coral below — the same reading in both themes because both
 *  ends are theme tokens rather than fixed hexes. */
function scoreColor(score: number): string {
  if (score >= 0.66) return 'var(--success, var(--cyan-bright))';
  if (score <= 0.4) return 'var(--coral-bright)';
  return 'var(--text-secondary)';
}

/** A horizontal satisfaction bar. Width is the score; colour is the verdict. */
function ScoreBar({ score }: { score: number }) {
  return (
    <div
      aria-hidden
      style={{
        position: 'relative',
        height: 6,
        borderRadius: 'var(--radius-full)',
        background: 'var(--bg-elevated)',
        overflow: 'hidden',
        minWidth: 60,
      }}
    >
      <div style={{ width: `${Math.round(score * 100)}%`, height: '100%', background: scoreColor(score) }} />
    </div>
  );
}

function bucketLabel(bucket: Pick<LlmRatingBucket, 'actionType' | 'toolName'>, noToolLabel: string): string {
  return bucket.toolName ? bucket.toolName : `${bucket.actionType} · ${noToolLabel}`;
}

export default function LlmRatingsPanel() {
  const t = useTranslations('admin.llmRatings');
  const [days, setDays] = useState(30);
  const { data, loading, error, reload } = useAdminData<LlmRatingSummary>(
    () => adminApi.llmRatings(days),
    [days],
  );

  if (loading && !data) return <AdminLoading />;

  const totals = data?.totals;
  const empty = !totals || totals.total === 0;

  return (
    <div>
      <AdminPanelHeader
        title={t('title')}
        subtitle={t('subtitle')}
        count={totals ? t('count', { total: fmtNum(totals.total), models: fmtNum(data?.models ?? 0) }) : undefined}
        onRefresh={reload}
        actions={
          <select
            className="admin-select"
            aria-label={t('periodLabel')}
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
          >
            <option value={7}>{t('period7')}</option>
            <option value={30}>{t('period30')}</option>
            <option value={90}>{t('period90')}</option>
            <option value={365}>{t('period365')}</option>
          </select>
        }
      />

      <AdminError message={error} />

      {empty ? (
        <div style={{ ...card }}>
          <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>{t('emptyTitle')}</p>
          <p className="text-muted" style={{ margin: '6px 0 0', fontSize: 'var(--font-size-small)' }}>{t('emptyBody')}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Headline: how much evidence there is, and how it leans overall. */}
          <div style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16 }}>
            <div>
              <div className="text-muted" style={{ fontSize: 'var(--font-size-eyebrow)', textTransform: 'uppercase', letterSpacing: .4 }}>{t('statSatisfaction')}</div>
              <div style={{ fontSize: 'var(--font-size-section)', fontWeight: 700, color: scoreColor(totals.score) }}>{pct(totals.score)}</div>
            </div>
            <div>
              <div className="text-muted" style={{ fontSize: 'var(--font-size-eyebrow)', textTransform: 'uppercase', letterSpacing: .4 }}>{t('statUp')}</div>
              <div style={{ fontSize: 'var(--font-size-section)', fontWeight: 700, color: 'var(--text-strong)' }}>{fmtNum(totals.up)}</div>
            </div>
            <div>
              <div className="text-muted" style={{ fontSize: 'var(--font-size-eyebrow)', textTransform: 'uppercase', letterSpacing: .4 }}>{t('statDown')}</div>
              <div style={{ fontSize: 'var(--font-size-section)', fontWeight: 700, color: 'var(--text-strong)' }}>{fmtNum(totals.down)}</div>
            </div>
            <div>
              <div className="text-muted" style={{ fontSize: 'var(--font-size-eyebrow)', textTransform: 'uppercase', letterSpacing: .4 }}>{t('statModels')}</div>
              <div style={{ fontSize: 'var(--font-size-section)', fontWeight: 700, color: 'var(--text-strong)' }}>{fmtNum(data?.models ?? 0)}</div>
            </div>
          </div>

          {/* The finding, stated. Only buckets where two or more models were rated
              produce a verdict — "best of one" is not a comparison. */}
          <div style={card}>
            <h3 style={{ margin: '0 0 4px', fontSize: 'var(--font-size-body)', fontWeight: 600, color: 'var(--text-strong)' }}>{t('verdictsTitle')}</h3>
            <p className="text-muted" style={{ margin: '0 0 12px', fontSize: 'var(--font-size-small)' }}>{t('verdictsHint')}</p>
            {(data?.leaders.length ?? 0) === 0 ? (
              <p className="text-muted" style={{ margin: 0, fontSize: 'var(--font-size-small)' }}>{t('verdictsEmpty')}</p>
            ) : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {data!.leaders.map((leader) => (
                  <li
                    key={`${leader.actionType}-${leader.toolName ?? ''}`}
                    style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8, fontSize: 'var(--font-size-small)', color: 'var(--text-primary)' }}
                  >
                    <code style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
                      {bucketLabel(leader, t('noTool'))}
                    </code>
                    <span>
                      {t.rich('verdict', {
                        winner: () => <strong style={{ color: scoreColor(leader.winner.score) }}>{leader.winner.model}</strong>,
                        loser: () => <span style={{ color: 'var(--text-secondary)' }}>{leader.runnerUp.model}</span>,
                        points: Math.round(leader.margin * 100),
                        n: leader.winner.total,
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* The full breakdown. Wide on purpose, so it scrolls inside its own box
              rather than pushing the page sideways on a narrow viewport. */}
          <div style={card}>
            <h3 style={{ margin: '0 0 12px', fontSize: 'var(--font-size-body)', fontWeight: 600, color: 'var(--text-strong)' }}>{t('breakdownTitle')}</h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-small)', minWidth: 640 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--text-secondary)' }}>
                    <th style={{ padding: '6px 8px' }}>{t('colModel')}</th>
                    <th style={{ padding: '6px 8px' }}>{t('colAction')}</th>
                    <th style={{ padding: '6px 8px' }}>{t('colTool')}</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>{t('colUp')}</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>{t('colDown')}</th>
                    <th style={{ padding: '6px 8px', minWidth: 140 }}>{t('colScore')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.buckets.map((bucket) => (
                    <tr
                      key={`${bucket.model}-${bucket.actionType}-${bucket.toolName ?? ''}`}
                      style={{ borderTop: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
                    >
                      <td style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)' }}>{bucket.model}</td>
                      <td style={{ padding: '6px 8px' }}>{bucket.actionType}</td>
                      <td style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                        {bucket.toolName ?? t('noTool')}
                      </td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmtNum(bucket.up)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmtNum(bucket.down)}</td>
                      <td style={{ padding: '6px 8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <ScoreBar score={bucket.score} />
                          <span style={{ color: scoreColor(bucket.score), fontWeight: 600, minWidth: 38, textAlign: 'right' }}>
                            {pct(bucket.score)}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-muted" style={{ margin: '10px 0 0', fontSize: 'var(--font-size-eyebrow)' }}>{t('scoreNote')}</p>
          </div>
        </div>
      )}
    </div>
  );
}
