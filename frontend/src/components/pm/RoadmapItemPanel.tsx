'use client';

import { useState } from 'react';
import type { TrackerRow } from '@/lib/builderforceApi';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { roadmapClient, ROADMAP_HORIZONS, ROADMAP_STATUSES, rstr } from '@/lib/pm/roadmap';

/**
 * Create/edit a roadmap item. Shared by RoadmapTimeline (add / click a card) and
 * RoadmapGantt (click a bar) so the roadmap CRUD form is defined once. A null
 * `item` means create (inherits the current project scope); a row means edit.
 */
export interface RoadmapItemPanelProps {
  open: boolean;
  /** null = create, a row = edit. */
  item: TrackerRow | null;
  projectId: number | null;
  onClose: () => void;
  onSaved: () => void;
}

const labelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4, display: 'block' };
const fieldStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border-subtle)',
  background: 'var(--bg-elevated)', color: 'var(--text-primary)', fontSize: 14,
};

export function RoadmapItemPanel({ open, item, projectId, onClose, onSaved }: RoadmapItemPanelProps) {
  const isEdit = item != null;
  const [title, setTitle] = useState(item ? rstr(item, 'title') : '');
  const [horizon, setHorizon] = useState(item ? rstr(item, 'horizon') || 'now' : 'now');
  const [status, setStatus] = useState(item ? rstr(item, 'status') || 'planned' : 'planned');
  const [theme, setTheme] = useState(item ? rstr(item, 'theme') : '');
  const [targetDate, setTargetDate] = useState(item ? rstr(item, 'targetDate').slice(0, 10) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!title.trim()) { setError('Title is required.'); return; }
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      title: title.trim(),
      horizon,
      status,
      theme: theme.trim() || null,
      targetDate: targetDate ? new Date(targetDate).toISOString() : null,
    };
    try {
      if (isEdit) await roadmapClient.update(String(item!.id), body);
      else await roadmapClient.create({ ...body, projectId: projectId ?? undefined });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SlideOutPanel open={open} onClose={onClose} title={isEdit ? 'Edit roadmap item' : 'New roadmap item'}>
      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <label style={labelStyle} htmlFor="rm-title">Title</label>
          <input id="rm-title" value={title} onChange={(e) => setTitle(e.target.value)} style={fieldStyle} placeholder="What ships?" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={labelStyle} htmlFor="rm-horizon">Horizon</label>
            <select id="rm-horizon" value={horizon} onChange={(e) => setHorizon(e.target.value)} style={fieldStyle}>
              {ROADMAP_HORIZONS.map((h) => <option key={h.key} value={h.key}>{h.label}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle} htmlFor="rm-status">Status</label>
            <select id="rm-status" value={status} onChange={(e) => setStatus(e.target.value)} style={fieldStyle}>
              {ROADMAP_STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label style={labelStyle} htmlFor="rm-theme">Theme</label>
          <input id="rm-theme" value={theme} onChange={(e) => setTheme(e.target.value)} style={fieldStyle} placeholder="Optional grouping" />
        </div>
        <div>
          <label style={labelStyle} htmlFor="rm-target">Target date</label>
          <input id="rm-target" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} style={fieldStyle} />
        </div>
        {error && <div style={{ color: 'var(--danger, #dc2626)', fontSize: 13 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={save} disabled={busy} style={{ padding: '8px 18px', borderRadius: 6, border: 'none', background: 'var(--coral-bright)', color: '#fff', fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
            {isEdit ? 'Save changes' : 'Create'}
          </button>
          <button type="button" onClick={onClose} style={{ padding: '8px 18px', borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}>Cancel</button>
        </div>
      </div>
    </SlideOutPanel>
  );
}
