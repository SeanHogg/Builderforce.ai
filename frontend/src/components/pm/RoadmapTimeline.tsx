'use client';

import { useState } from 'react';
import { segmentTrackerClient, type TrackerRow } from '@/lib/builderforceApi';
import { usePmScope } from '@/lib/pm/scope';
import { usePmData } from '@/lib/pm/usePmData';
import { PmEmpty, PmError, StatusPill } from './pmShared';

/**
 * Roadmap "now / next / later" horizon swimlanes from roadmap_items, with inline
 * create + delete (the canonical roadmap management surface, replacing the old
 * generic TrackerSurface embed). Project view (scoped) or portfolio (all segment
 * rows) per the active PM scope; a created item inherits the current project scope.
 */
const roadmapClient = segmentTrackerClient('/api/product/roadmap');

const HORIZONS: Array<{ key: string; label: string }> = [
  { key: 'now', label: 'Now' },
  { key: 'next', label: 'Next' },
  { key: 'later', label: 'Later' },
];

function str(row: TrackerRow, key: string): string {
  const v = row[key];
  return typeof v === 'string' ? v : '';
}

export function RoadmapTimeline() {
  const { projectId } = usePmScope();
  const { data, error, reload } = usePmData<TrackerRow[]>(
    () => roadmapClient.list(projectId ?? undefined),
    [projectId],
  );

  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [horizon, setHorizon] = useState('now');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const create = async () => {
    if (!title.trim()) { setFormError('Title is required.'); return; }
    setBusy(true);
    setFormError(null);
    try {
      await roadmapClient.create({ title: title.trim(), horizon, status: 'planned', projectId: projectId ?? undefined });
      setTitle('');
      setAdding(false);
      reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this roadmap item?')) return;
    try { await roadmapClient.remove(id); reload(); } catch { /* surfaced on next load */ }
  };

  const inputStyle: React.CSSProperties = {
    padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border-subtle)',
    background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 13,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {!adding ? (
          <button
            type="button"
            onClick={() => { setAdding(true); setFormError(null); }}
            style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: 'var(--coral-bright)', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
          >
            + Add item
          </button>
        ) : (
          <>
            <input aria-label="Roadmap item title" placeholder="Item title…" value={title} onChange={(e) => setTitle(e.target.value)} style={{ ...inputStyle, minWidth: 220 }} />
            <select aria-label="Horizon" value={horizon} onChange={(e) => setHorizon(e.target.value)} style={inputStyle}>
              {HORIZONS.map((h) => <option key={h.key} value={h.key}>{h.label}</option>)}
            </select>
            <button type="button" onClick={create} disabled={busy} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: 'var(--coral-bright)', color: '#fff', fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>Save</button>
            <button type="button" onClick={() => { setAdding(false); setFormError(null); }} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}>Cancel</button>
            {formError && <span style={{ color: 'var(--danger, #dc2626)', fontSize: 13 }}>{formError}</span>}
          </>
        )}
      </div>

      {error ? (
        <PmError message={error} />
      ) : !data ? (
        <PmEmpty message="Loading roadmap…" />
      ) : !data.length ? (
        <PmEmpty message="No roadmap items yet. Use “Add item” to create one." />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {HORIZONS.map(({ key, label }) => {
            const items = data.filter((r) => (str(r, 'horizon') || 'now') === key);
            return (
              <div key={key} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700 }}>{label}</h4>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{items.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {items.length === 0 && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>—</div>}
                  {items.map((r) => (
                    <div key={String(r.id)} style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '10px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.86rem' }}>{str(r, 'title')}</div>
                        <button type="button" aria-label="Delete item" title="Delete" onClick={() => remove(String(r.id))} style={{ border: 'none', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>×</button>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <StatusPill value={str(r, 'status') || 'planned'} />
                        {str(r, 'theme') && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{str(r, 'theme')}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
