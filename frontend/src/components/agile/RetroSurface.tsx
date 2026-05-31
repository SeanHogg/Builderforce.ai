'use client';

import { useCallback, useEffect, useState } from 'react';
import { retroApi, type Retrospective, type RetroDetail } from '@/lib/builderforceApi';

/**
 * Retrospectives embed surface. Retro → columns (by template) → items with
 * upvotes. Live via 2s polling of the retro detail.
 */

const TEMPLATES: Record<string, string[]> = {
  start_stop_continue: ['Start', 'Stop', 'Continue'],
  mad_sad_glad: ['Mad', 'Sad', 'Glad'],
  four_ls: ['Liked', 'Learned', 'Lacked', 'Longed for'],
  what_went_well: ['Went well', 'To improve', 'Action items'],
};
const TEMPLATE_OPTIONS = Object.keys(TEMPLATES);

export function RetroSurface() {
  const [retros, setRetros] = useState<Retrospective[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<RetroDetail | null>(null);
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('start_stop_continue');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const loadRetros = useCallback(() => {
    retroApi.list().then(setRetros).catch(() => setError('Could not load retros.'));
  }, []);
  useEffect(loadRetros, [loadRetros]);

  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    let active = true;
    const tick = () => retroApi.get(selected).then((d) => active && setDetail(d)).catch(() => {});
    tick();
    const iv = setInterval(tick, 2000);
    return () => { active = false; clearInterval(iv); };
  }, [selected]);

  const refresh = () => { if (selected) retroApi.get(selected).then(setDetail).catch(() => {}); };

  const createRetro = async () => {
    if (!name.trim()) return;
    try { const r = await retroApi.create(name.trim(), template); setName(''); loadRetros(); setSelected(r.id); }
    catch { setError('Create failed (manager role required).'); }
  };

  const addItem = async (category: string) => {
    const content = (drafts[category] ?? '').trim();
    if (!selected || !content) return;
    try { await retroApi.addItem(selected, category, content); setDrafts((d) => ({ ...d, [category]: '' })); refresh(); }
    catch { setError('Add failed.'); }
  };

  const upvote = (id: string) => retroApi.voteItem(id).then(refresh).catch(() => {});

  if (!selected) {
    return (
      <div>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Retrospectives</div>
        {error && <div role="alert" style={{ color: '#dc2626', marginBottom: 8 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New retro name" style={inp} />
          <select value={template} onChange={(e) => setTemplate(e.target.value)} style={{ ...inp, flex: '0 0 auto' }}>
            {TEMPLATE_OPTIONS.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
          <button onClick={createRetro} style={btn}>Create</button>
        </div>
        <div style={{ display: 'grid', gap: 6 }}>
          {retros.map((r) => (
            <button key={r.id} onClick={() => setSelected(r.id)} style={row}>
              <span style={{ fontWeight: 600 }}>{r.name}</span>
              <span style={{ color: '#64748b', fontSize: 12 }}>{r.template.replace(/_/g, ' ')}</span>
            </button>
          ))}
          {retros.length === 0 && <div style={{ color: '#64748b' }}>No retrospectives yet.</div>}
        </div>
      </div>
    );
  }

  const columns = TEMPLATES[detail?.template ?? 'start_stop_continue'] ?? ['Notes'];

  return (
    <div>
      <button onClick={() => setSelected(null)} style={link}>← Retrospectives</button>
      <div style={{ fontSize: 16, fontWeight: 600, margin: '8px 0' }}>{detail?.name ?? 'Loading…'}</div>
      {error && <div role="alert" style={{ color: '#dc2626', marginBottom: 8 }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns.length}, 1fr)`, gap: 12 }}>
        {columns.map((col) => {
          const items = (detail?.items ?? []).filter((i) => i.category === col).sort((a, b) => b.votes - a.votes);
          return (
            <div key={col} style={colStyle}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>{col}</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                <input value={drafts[col] ?? ''} onChange={(e) => setDrafts((d) => ({ ...d, [col]: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && addItem(col)} placeholder="Add…" style={{ ...inp, fontSize: 12 }} />
                <button onClick={() => addItem(col)} style={{ ...btn, padding: '4px 10px' }}>+</button>
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {items.map((it) => (
                  <div key={it.id} style={itemStyle}>
                    <span style={{ flex: 1 }}>{it.content}</span>
                    <button onClick={() => upvote(it.id)} style={voteBtn}>▲ {it.votes}</button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const inp: React.CSSProperties = { fontSize: 13, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border-subtle, #e2e8f0)', background: 'var(--bg-base, #fff)', flex: 1, minWidth: 0 };
const btn: React.CSSProperties = { padding: '6px 14px', fontSize: 13, fontWeight: 600, background: 'var(--accent, #2563eb)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' };
const link: React.CSSProperties = { background: 'none', border: 'none', color: 'var(--accent, #2563eb)', cursor: 'pointer', fontSize: 13, padding: 0 };
const row: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', border: '1px solid var(--border-subtle, #e2e8f0)', borderRadius: 8, background: 'var(--bg-base, #fff)', cursor: 'pointer', textAlign: 'left' };
const colStyle: React.CSSProperties = { border: '1px solid var(--border-subtle, #e2e8f0)', borderRadius: 8, padding: 12, background: 'var(--bg-base, #f8fafc)', minWidth: 0 };
const itemStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '6px 8px', borderRadius: 6, background: 'var(--bg-elevated, #fff)', border: '1px solid var(--border-subtle, #eef2f7)' };
const voteBtn: React.CSSProperties = { fontSize: 11, fontWeight: 600, padding: '2px 6px', borderRadius: 6, border: '1px solid var(--border-subtle, #e2e8f0)', background: 'transparent', cursor: 'pointer', whiteSpace: 'nowrap' };
