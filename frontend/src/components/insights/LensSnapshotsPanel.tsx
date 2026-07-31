'use client';

/**
 * LensSnapshotsPanel — the "Review snapshots" panel for the Insights hub. Lists
 * the periodic (monthly / quarterly / annual) lens snapshots captured by the
 * annual-calendar cadence, filterable by lens + cadence, with a manager "capture
 * now" action and a period picker. Reading a row loads its frozen payload.
 *
 * Manager surface (the API gates it at MANAGER+); wrap the mount in a
 * <RoleGate capability="insights.engineering"> at the call site for the honest
 * disabled-state. Theme-token styled, responsive, localized (`lensSnapshots`).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  lensSnapshotsApi,
  type LensSnapshotMeta,
  type SnapshotCadence,
} from '@/lib/personaCadenceApi';
import { Select } from '@/components/Select';

const card: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 20,
};
const selectStyle: React.CSSProperties = {
  padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: '0.83rem',
};
const btn: React.CSSProperties = {
  padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)',
  background: 'var(--bg-elevated)', color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 600, fontSize: '0.82rem',
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function LensSnapshotsPanel() {
  const t = useTranslations('lensSnapshots');

  const [snapshots, setSnapshots] = useState<LensSnapshotMeta[]>([]);
  const [lensList, setLensList] = useState<string[]>([]);
  const [cadences, setCadences] = useState<SnapshotCadence[]>(['monthly', 'quarterly', 'annual']);
  const [lensFilter, setLensFilter] = useState<string>('');
  const [captureLens, setCaptureLens] = useState<string>('');
  const [captureCadence, setCaptureCadence] = useState<SnapshotCadence>('monthly');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const r = await lensSnapshotsApi.list(lensFilter ? { lens: lensFilter } : {});
      setSnapshots(r.snapshots);
      setLensList(r.snapshotableLenses);
      setCadences(r.cadences);
      if (!captureLens && r.snapshotableLenses.length) setCaptureLens(r.snapshotableLenses[0]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [lensFilter, captureLens]);

  useEffect(() => { void reload(); }, [reload]);

  const captureNow = async () => {
    if (!captureLens) return;
    setBusy(true); setError(null);
    try {
      await lensSnapshotsApi.capture(captureLens, captureCadence);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const openSnapshot = async (id: string) => {
    if (openId === id) { setOpenId(null); setPayload(null); return; }
    setOpenId(id); setPayload(null);
    try {
      const r = await lensSnapshotsApi.get(id);
      setPayload(r.snapshot.payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const cadenceLabel = useMemo(() => (c: SnapshotCadence | null) => (c ? t(c) : '—'), [t]);

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{t('title')}</div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>{t('subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Select style={selectStyle} value={captureLens} onChange={(e) => setCaptureLens(e.target.value)} aria-label={t('lens')}>
            {lensList.map((l) => <option key={l} value={l}>{t(`lensNames.${l}`)}</option>)}
          </Select>
          <Select style={selectStyle} value={captureCadence} onChange={(e) => setCaptureCadence(e.target.value as SnapshotCadence)} aria-label={t('cadence')}>
            {cadences.map((c) => <option key={c} value={c}>{t(c)}</option>)}
          </Select>
          <button type="button" style={btn} onClick={() => void captureNow()} disabled={busy || !captureLens}>
            {busy ? t('capturing') : t('captureNow')}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('filterLens')}</span>
        <Select style={selectStyle} value={lensFilter} onChange={(e) => setLensFilter(e.target.value)} aria-label={t('filterLens')}>
          <option value="">{t('allLenses')}</option>
          {lensList.map((l) => <option key={l} value={l}>{t(`lensNames.${l}`)}</option>)}
        </Select>
      </div>

      {error && <div style={{ fontSize: 12, color: 'var(--coral-bright, #f4726e)', marginBottom: 10 }}>{error}</div>}

      {loading ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('loading')}</div>
      ) : snapshots.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('empty')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {snapshots.map((s) => (
            <div key={s.id} style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--bg-elevated)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', minWidth: 110 }}>{t(`lensNames.${s.lens}`)}</span>
                <span style={{
                  fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                  background: 'var(--bg-surface, var(--bg-base))', color: 'var(--text-secondary)',
                }}>{s.period}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{cadenceLabel(s.cadence)}</span>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('generatedAt', { at: fmt(s.generatedAt) })}</span>
                <button type="button" style={{ ...btn, padding: '4px 10px', fontSize: 11 }} onClick={() => void openSnapshot(s.id)}>
                  {openId === s.id ? t('hide') : t('view')}
                </button>
              </div>
              {openId === s.id && (
                <pre style={{
                  margin: 0, padding: 12, borderTop: '1px solid var(--border-subtle)', overflowX: 'auto',
                  fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', maxHeight: 320,
                }}>
                  {payload ? JSON.stringify(payload, null, 2) : t('loading')}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
