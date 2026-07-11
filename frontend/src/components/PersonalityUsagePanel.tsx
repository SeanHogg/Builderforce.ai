'use client';

/**
 * PersonalityUsagePanel — the user-facing surface for personality LEARNING +
 * TRACKING (Gaps 6 & 7). For a given cloud agent it shows:
 *
 *   • WHICH personality/persona was applied to its recent runs, and WHEN (from
 *     `personality_events`, plus live-derived entries from real terminal runs), and
 *   • the SUGGESTED trait reinforcement computed from those run outcomes, with
 *     Apply / Dismiss — the human/manager approval that commits a bounded, reversible
 *     nudge to the agent's psychometric vector.
 *
 * Theme-aware (CSS design tokens, styled for light + dark) and responsive. Self-hides
 * nothing — it always renders its own empty states so it can be dropped into a tab.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePsychometricCatalog } from '@/lib/usePsychometricCatalog';
import {
  fetchPersonalityEvents,
  fetchTraitReinforcements,
  applyTraitReinforcement,
  dismissTraitReinforcement,
  type PersonalityEvent,
  type ReinforcementResponse,
} from '@/lib/api';

function formatWhen(at: string | null): string {
  if (!at) return '';
  const d = new Date(at);
  return Number.isNaN(d.valueOf()) ? '' : d.toLocaleString();
}

export default function PersonalityUsagePanel({
  agentId,
  canApply,
  onApplied,
}: {
  agentId: string;
  /** Owner/manager: may Apply/Dismiss reinforcements (else read-only). */
  canApply: boolean;
  /** Called after a successful apply so the parent can refresh the profile view. */
  onApplied?: () => void;
}) {
  const t = useTranslations('personalityUsage');
  const { catalog } = usePsychometricCatalog();

  const [events, setEvents] = useState<PersonalityEvent[] | null>(null);
  const [activeSummary, setActiveSummary] = useState('');
  const [reinf, setReinf] = useState<ReinforcementResponse | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // dimension id -> display name
  const dimName = useCallback(
    (id: string): string => {
      for (const fw of catalog?.frameworks ?? []) for (const d of fw.dimensions) if (d.id === id) return d.name;
      return id;
    },
    [catalog],
  );

  const load = useCallback(async () => {
    setError('');
    try {
      const [ev, rf] = await Promise.all([
        fetchPersonalityEvents(agentId, 20),
        fetchTraitReinforcements(agentId, 14),
      ]);
      setEvents(ev.events);
      setActiveSummary(ev.activeSummary);
      setReinf(rf);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errLoad'));
    }
  }, [agentId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const proposal = reinf?.proposal ?? null;

  const onApply = useCallback(async () => {
    if (!proposal || !reinf) return;
    setBusy(true);
    setError('');
    try {
      await applyTraitReinforcement(agentId, {
        deltas: proposal.deltas,
        rationale: proposal.rationale,
        basedOnRuns: reinf.basedOnRuns,
        windowDays: reinf.windowDays,
      });
      onApplied?.();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errApply'));
    } finally {
      setBusy(false);
    }
  }, [agentId, proposal, reinf, onApplied, load, t]);

  const onDismiss = useCallback(async () => {
    if (!proposal) return;
    setBusy(true);
    setError('');
    try {
      await dismissTraitReinforcement(agentId, { deltas: proposal.deltas, rationale: proposal.rationale });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errDismiss'));
    } finally {
      setBusy(false);
    }
  }, [agentId, proposal, load, t]);

  const cardStyle: React.CSSProperties = {
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: 14,
    background: 'var(--surface)',
  };

  const deltaChip = (dim: string, d: number) => (
    <span
      key={dim}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 11,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 9999,
        background: d > 0 ? 'var(--surface-success-soft, var(--surface-2))' : 'var(--surface-coral-soft, var(--surface-2))',
        color: d > 0 ? 'var(--success-text, var(--text-strong))' : 'var(--coral-bright, var(--text-strong))',
        border: '1px solid var(--border)',
      }}
    >
      {dimName(dim)} {d > 0 ? `+${d}` : d}
    </span>
  );

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }} aria-label={t('title')}>
      {error && <div style={{ fontSize: 13, color: 'var(--error-text)' }}>{error}</div>}

      {/* Active personality summary */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 15 }} aria-hidden>🧭</span>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-strong)' }}>{t('activeTitle')}</div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
          {activeSummary ? activeSummary : t('activeNone')}
        </div>
      </div>

      {/* Suggested reinforcement */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <span style={{ fontSize: 15 }} aria-hidden>🌱</span>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-strong)' }}>{t('reinforceTitle')}</div>
          {reinf && (
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)' }}>
              {t('basedOn', { count: reinf.basedOnRuns, days: reinf.windowDays })}
            </span>
          )}
        </div>

        {!reinf ? (
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('loading')}</div>
        ) : proposal ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {Object.entries(proposal.deltas).map(([dim, d]) => deltaChip(dim, d))}
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {proposal.rationale.map((r, i) => (
                <li key={i} style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{r}</li>
              ))}
            </ul>
            {canApply ? (
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={onDismiss}
                  disabled={busy}
                  style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'var(--bg-elevated)', color: 'var(--text-strong)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer' }}
                >
                  {t('dismiss')}
                </button>
                <button
                  type="button"
                  onClick={onApply}
                  disabled={busy}
                  style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
                >
                  {busy ? t('applying') : t('apply')}
                </button>
              </div>
            ) : (
              <div style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>{t('applyOwnerOnly')}</div>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            {reinf.rationale?.[0] ?? t('noProposal')}
          </div>
        )}
      </div>

      {/* Recent applications (which personality was used, when) */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 15 }} aria-hidden>🕑</span>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-strong)' }}>{t('recentTitle')}</div>
        </div>
        {events == null ? (
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('loading')}</div>
        ) : events.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('recentNone')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {events.map((ev) => (
              <div
                key={ev.id}
                style={{ padding: '10px 12px', border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--bg-elevated)' }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-strong)' }}>
                    {ev.directivesSummary || t('activeNone')}
                  </span>
                  {!ev.recorded && (
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 9999, background: 'var(--surface-2)', color: 'var(--muted)' }}>
                      {t('derived')}
                    </span>
                  )}
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                    {formatWhen(ev.at)}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
                  {ev.personaIds.length > 0 && (
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{ev.personaIds.join(', ')}</span>
                  )}
                  {ev.thinkLevel && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{t('think', { level: ev.thinkLevel })}</span>}
                  {ev.reasoningLevel === 'on' && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{t('reasoning')}</span>}
                  {typeof ev.temperature === 'number' && <span style={{ fontSize: 11, color: 'var(--muted)' }}>{t('temp', { value: ev.temperature })}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reinforcement history */}
      {reinf && reinf.history.length > 0 && (
        <div style={cardStyle}>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-strong)', marginBottom: 10 }}>{t('historyTitle')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {reinf.history.map((h) => (
              <div key={h.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', fontSize: 11 }}>
                <span
                  style={{
                    fontWeight: 700,
                    color: h.status === 'applied' ? 'var(--success-text, var(--text-strong))' : h.status === 'dismissed' ? 'var(--muted)' : 'var(--text-strong)',
                  }}
                >
                  {t(`status_${h.status}` as 'status_applied' | 'status_dismissed' | 'status_proposed')}
                </span>
                <span style={{ color: 'var(--text-secondary)' }}>
                  {Object.entries(h.deltas).map(([dim, d]) => `${dimName(dim)} ${d > 0 ? '+' : ''}${d}`).join(', ')}
                </span>
                <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>{formatWhen(h.decidedAt ?? h.proposedAt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
