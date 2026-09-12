'use client';

import { Select } from '@/components/Select';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { governanceApi, type SocControl } from '@/lib/builderforceApi';
import { statusColor, type StatusToneMap } from '@/lib/statusTone';

/**
 * SOC 2 Control Tracker (doc 07 SEC-1). Lists the CC1–CC9 controls for the active
 * segment, shows a readiness scoreboard, and lets a manager seed the baseline +
 * set per-control status. The real Security-pillar embed surface for `soc2`.
 */

/** Status order. Labels resolve under `soc2Tracker.status.<status>`. */
const STATUS_ORDER: SocControl['status'][] = ['not_started', 'in_progress', 'ready', 'out_of_scope'];
const STATUS_TONE: StatusToneMap<SocControl['status']> = {
  not_started: 'neutral',
  in_progress: 'warning',
  ready: 'success',
  out_of_scope: 'neutral',
};

/** Readiness = ready / (controls not marked out_of_scope). Shared by overall + per-category. */
function readiness(controls: SocControl[]): { ready: number; inScope: number; pct: number } {
  const inScope = controls.filter((c) => c.status !== 'out_of_scope');
  const ready = inScope.filter((c) => c.status === 'ready').length;
  return { ready, inScope: inScope.length, pct: inScope.length ? Math.round((ready / inScope.length) * 100) : 0 };
}

export function Soc2Content() {
  const t = useTranslations('soc2Tracker');
  const [controls, setControls] = useState<SocControl[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    governanceApi.soc2
      .listControls()
      .then(setControls)
      .catch(() => setError(t('loadFailed')))
      .finally(() => setLoading(false));
  }, [t]);
  useEffect(load, [load]);

  const byCategory = useMemo(() => {
    const map = new Map<string, SocControl[]>();
    for (const c of [...controls].sort((a, b) => a.controlRef.localeCompare(b.controlRef))) {
      (map.get(c.category) ?? map.set(c.category, []).get(c.category)!).push(c);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [controls]);

  const overall = readiness(controls);

  const seed = async () => {
    setBusy(true);
    setError(null);
    try {
      await governanceApi.soc2.seed();
      load();
    } catch {
      setError(t('seedFailed'));
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (id: string, status: SocControl['status']) => {
    setControls((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c))); // optimistic
    try {
      await governanceApi.soc2.patchControl(id, { status });
    } catch {
      setError(t('updateFailed'));
      load();
    }
  };

  if (loading) return <div style={{ color: 'var(--text-secondary)' }}>{t('loading')}</div>;

  if (controls.length === 0) {
    return (
      <div>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{t('title')}</div>
        <div style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>{t('emptyBody')}</div>
        <button onClick={seed} disabled={busy} style={btnStyle}>{busy ? t('seeding') : t('seed')}</button>
        {error && <div role="alert" style={{ color: 'var(--error-text)', marginTop: 8 }}>{error}</div>}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{t('title')}</div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {t.rich('readiness', {
            pct: overall.pct,
            ready: overall.ready,
            inScope: overall.inScope,
            strong: (chunks) => <strong style={{ color: 'var(--text-primary)' }}>{chunks}</strong>,
          })}
        </div>
      </div>
      {error && <div role="alert" style={{ color: 'var(--error-text)', marginBottom: 8 }}>{error}</div>}

      {byCategory.map(([category, items]) => {
        const r = readiness(items);
        return (
          <div key={category} style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              {category} <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>{t('categoryReady', { pct: r.pct })}</span>
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              {items.map((c) => (
                <div key={c.id} style={rowStyle}>
                  <span style={{ fontWeight: 600, minWidth: 52 }}>{c.controlRef}</span>
                  <span style={{ flex: 1 }}>{c.name}</span>
                  <span aria-hidden style={{ width: 8, height: 8, borderRadius: 'var(--radius-md)', background: statusColor(STATUS_TONE, c.status, 'solid') }} />
                  <Select value={c.status} onChange={(e) => setStatus(c.id, e.target.value as SocControl['status'])} style={selectStyle}>
                    {STATUS_ORDER.map((s) => (
                      <option key={s} value={s}>{t(`status.${s}`)}</option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: '6px 14px', fontSize: 13, fontWeight: 600,
  background: 'var(--accent)', color: 'var(--text-on-accent)', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer',
};
const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, fontSize: 13,
  padding: '6px 10px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)',
};
const selectStyle: React.CSSProperties = {
  fontSize: 12, padding: '2px 6px', borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border-subtle)', background: 'var(--bg-base)',
};
