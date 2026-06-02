'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { specsApi, type Task, type Spec } from '@/lib/builderforceApi';
import { ChatMessageContent } from '../ChatMessageContent';

/**
 * "PRD" tab of the task details panel. Agents hand off between swimlanes via a
 * PRD, so the task panel surfaces the project's PRD(s) rendered as markdown,
 * with an expand-to-fullscreen control for comfortable reading.
 */

const selectStyle: React.CSSProperties = {
  padding: '7px 10px', fontSize: 13, border: '1px solid var(--border-subtle)', borderRadius: 8,
  background: 'var(--bg-deep)', color: 'var(--text-primary)', cursor: 'pointer',
};
const iconBtn: React.CSSProperties = {
  width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
  border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--bg-base)',
  color: 'var(--text-secondary)', cursor: 'pointer',
};

function ExpandIcon() {
  return (
    <svg viewBox="0 0 24 24" style={{ width: 16, height: 16, stroke: 'currentColor', fill: 'none', strokeWidth: 2 }}>
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  );
}

export function TaskPrdTab({ task }: { task: Task }) {
  const [specs, setSpecs] = useState<Spec[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    setLoading(true);
    specsApi.list(task.projectId)
      .then((list) => {
        const withPrd = list.filter((s) => s.prd);
        setSpecs(withPrd);
        if (withPrd.length > 0) setSelectedId(withPrd[0].id);
      })
      .catch(() => setSpecs([]))
      .finally(() => setLoading(false));
  }, [task.projectId]);

  const selected = specs.find((s) => s.id === selectedId) ?? null;

  if (loading) return <div style={{ padding: 20, fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>;

  if (specs.length === 0) {
    return (
      <div style={{ padding: 20, fontSize: 13, color: 'var(--text-muted)' }}>
        No PRD has been drafted for this project yet. Use the project&apos;s PRDs tab or Brain to draft one — agents
        use it to hand off work between swimlanes.
      </div>
    );
  }

  const body = (
    <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-primary)' }}>
      <ChatMessageContent content={selected?.prd ?? ''} />
    </div>
  );

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        {specs.length > 1 ? (
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} style={{ ...selectStyle, flex: 1 }}>
            {specs.map((s) => <option key={s.id} value={s.id}>{s.goal || `PRD ${s.id.slice(0, 8)}`} ({s.status})</option>)}
          </select>
        ) : (
          <div style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>{selected?.goal || 'PRD'} <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>· {selected?.status}</span></div>
        )}
        <button type="button" style={iconBtn} title="Expand to full screen" aria-label="Expand to full screen" onClick={() => setFullscreen(true)}>
          <ExpandIcon />
        </button>
      </div>
      {body}

      {fullscreen && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: 'fixed', inset: 0, zIndex: 10010, background: 'var(--bg-base)', display: 'flex', flexDirection: 'column' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{selected?.goal || 'PRD'}</div>
            <button type="button" style={iconBtn} aria-label="Close full screen" onClick={() => setFullscreen(false)}>
              <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, stroke: 'currentColor', fill: 'none', strokeWidth: 2 }}>
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '24px 32px', maxWidth: 900, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
            {body}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
