'use client';

import { Select } from '@/components/Select';

import { useEffect, useMemo, useState } from 'react';
import { governanceApi, type SocControl } from '@/lib/builderforceApi';

/**
 * SOC 2 Control Tracker (doc 07 SEC-1). Lists the CC1–CC9 controls for the active
 * segment, shows a readiness scoreboard, and lets a manager seed the baseline +
 * set per-control status. The real Security-pillar embed surface for `soc2`.
 */

const STATUS_LABELS: Record<SocControl['status'], string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  ready: 'Ready',
  out_of_scope: 'Out of scope',
};
const STATUS_ORDER: SocControl['status'][] = ['not_started', 'in_progress', 'ready', 'out_of_scope'];
const STATUS_COLOR: Record<SocControl['status'], string> = {
  not_started: '#94a3b8',
  in_progress: '#d97706',
  ready: '#16a34a',
  out_of_scope: '#64748b',
};

/** Readiness = ready / (controls not marked out_of_scope). Shared by overall + per-category. */
function readiness(controls: SocControl[]): { ready: number; inScope: number; pct: number } {
  const inScope = controls.filter((c) => c.status !== 'out_of_scope');
  const ready = inScope.filter((c) => c.status === 'ready').length;
  return { ready, inScope: inScope.length, pct: inScope.length ? Math.round((ready / inScope.length) * 100) : 0 };
}

export function Soc2Content() {
  const [controls, setControls] = useState<SocControl[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    governanceApi.soc2
      .listControls()
      .then(setControls)
      .catch(() => setError('Could not load SOC 2 controls.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

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
      setError('Seeding failed (manager role required).');
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (id: string, status: SocControl['status']) => {
    setControls((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c))); // optimistic
    try {
      await governanceApi.soc2.patchControl(id, { status });
    } catch {
      setError('Update failed.');
      load();
    }
  };

  if (loading) return <div style={{ color: '#64748b' }}>Loading SOC 2 controls…</div>;

  if (controls.length === 0) {
    return (
      <div>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>SOC 2 Control Tracker</div>
        <div style={{ color: '#64748b', marginBottom: 16 }}>No controls yet. Seed the SOC 2 Common Criteria (CC1–CC9) baseline to start tracking readiness.</div>
        <button onClick={seed} disabled={busy} style={btnStyle}>{busy ? 'Seeding…' : 'Seed SOC 2 baseline'}</button>
        {error && <div role="alert" style={{ color: '#dc2626', marginTop: 8 }}>{error}</div>}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>SOC 2 Control Tracker</div>
        <div style={{ fontSize: 13, color: '#64748b' }}>
          Readiness <strong style={{ color: 'var(--text-primary, #0f172a)' }}>{overall.pct}%</strong> ({overall.ready}/{overall.inScope} in scope)
        </div>
      </div>
      {error && <div role="alert" style={{ color: '#dc2626', marginBottom: 8 }}>{error}</div>}

      {byCategory.map(([category, items]) => {
        const r = readiness(items);
        return (
          <div key={category} style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              {category} <span style={{ color: '#64748b', fontWeight: 400 }}>· {r.pct}% ready</span>
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              {items.map((c) => (
                <div key={c.id} style={rowStyle}>
                  <span style={{ fontWeight: 600, minWidth: 52 }}>{c.controlRef}</span>
                  <span style={{ flex: 1 }}>{c.name}</span>
                  <span aria-hidden style={{ width: 8, height: 8, borderRadius: 8, background: STATUS_COLOR[c.status] }} />
                  <Select value={c.status} onChange={(e) => setStatus(c.id, e.target.value as SocControl['status'])} style={selectStyle}>
                    {STATUS_ORDER.map((s) => (
                      <option key={s} value={s}>{STATUS_LABELS[s]}</option>
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
  background: 'var(--accent, #2563eb)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer',
};
const rowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, fontSize: 13,
  padding: '6px 10px', border: '1px solid var(--border-subtle, #e2e8f0)', borderRadius: 6,
};
const selectStyle: React.CSSProperties = {
  fontSize: 12, padding: '2px 6px', borderRadius: 6,
  border: '1px solid var(--border-subtle, #e2e8f0)', background: 'var(--bg-base, #fff)',
};
