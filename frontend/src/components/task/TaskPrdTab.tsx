'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { specsApi, taskSpecsApi, type Spec } from '@/lib/builderforceApi';
import { ChatMessageContent } from '../ChatMessageContent';
import { Select } from '@/components/Select';
import { ViewToggle } from '@/components/ViewToggle';
import { unwrapMarkdownFence } from '@/lib/utils';
import { PrdCreateModal } from '../prd/PrdCreateModal';

/**
 * "PRD" tab of the task details panel. Agents hand off between swimlanes via a
 * PRD, so this surfaces the PRD(s) rendered as markdown with an expand-to-
 * fullscreen control.
 *
 * Two modes:
 *  - task-scoped (taskId given): the PRDs LINKED to the task (many-to-many), with
 *    attach / detach / set-primary controls and a Generate button when none exist.
 *  - project-scoped (no taskId): a read-only view of the project's PRDs.
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
const textBtn: React.CSSProperties = {
  padding: '6px 12px', fontSize: 12, border: '1px solid var(--border-subtle)', borderRadius: 8,
  background: 'var(--bg-base)', color: 'var(--text-secondary)', cursor: 'pointer',
};

function ExpandIcon() {
  return (
    <svg viewBox="0 0 24 24" style={{ width: 16, height: 16, stroke: 'currentColor', fill: 'none', strokeWidth: 2 }}>
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  );
}

export function TaskPrdTab({ taskId, projectId }: { taskId?: number; projectId: number }) {
  const [specs, setSpecs] = useState<Spec[]>([]);
  const [projectSpecs, setProjectSpecs] = useState<Spec[]>([]); // attach candidates (task mode)
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  // PRDs drafted by an LLM occasionally arrive wrapped in a whole-document
  // ```markdown fence, which renders as one raw "MARKDOWN" code box. Default to
  // the rendered Preview (fence stripped); let the user drop to RAW source.
  const [view, setView] = useState<'preview' | 'raw'>('preview');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (taskId != null) {
        const [linked, all] = await Promise.all([taskSpecsApi.list(taskId), specsApi.list(projectId)]);
        setSpecs(linked);
        setProjectSpecs(all);
        setSelectedId((prev) => (linked.some((s) => s.id === prev) ? prev : linked[0]?.id ?? ''));
      } else {
        const list = (await specsApi.list(projectId)).filter((s) => s.prd);
        setSpecs(list);
        setSelectedId((prev) => (list.some((s) => s.id === prev) ? prev : list[0]?.id ?? ''));
      }
    } catch {
      setSpecs([]);
    } finally {
      setLoading(false);
    }
  }, [taskId, projectId]);

  useEffect(() => { load(); }, [load]);

  const selected = specs.find((s) => s.id === selectedId) ?? null;
  const linkable = projectSpecs.filter((p) => !specs.some((s) => s.id === p.id));

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); await load(); } finally { setBusy(false); }
  };

  // Create a project-level PRD and link it to this task as primary.
  const createModal = showCreate && taskId != null ? (
    <PrdCreateModal
      projectId={projectId}
      onClose={() => setShowCreate(false)}
      onCreated={async (spec) => { setShowCreate(false); await run(() => taskSpecsApi.attach(taskId, spec.id, true)); }}
    />
  ) : null;

  if (loading) return <div style={{ padding: 20, fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>;

  // Empty state — task mode offers Generate; project mode just informs.
  if (specs.length === 0) {
    return (
      <div style={{ padding: 20, fontSize: 13, color: 'var(--text-muted)' }}>
        {taskId != null ? (
          <>
            <p style={{ marginTop: 0 }}>This task has no PRD yet. Agents use the PRD to understand the goal and hand off
              work between swimlanes.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" style={{ ...textBtn, opacity: busy ? 0.6 : 1 }} disabled={busy}
                onClick={() => run(() => taskSpecsApi.generate(taskId))}>
                {busy ? 'Generating…' : 'Generate with AI'}
              </button>
              <button type="button" style={{ ...textBtn, opacity: busy ? 0.6 : 1 }} disabled={busy}
                onClick={() => setShowCreate(true)}>Create PRD</button>
              {linkable.length > 0 && (
                <Select style={selectStyle} defaultValue="" disabled={busy}
                  onChange={(e) => e.target.value && run(() => taskSpecsApi.attach(taskId, e.target.value, true))}>
                  <option value="">Attach existing PRD…</option>
                  {linkable.map((s) => <option key={s.id} value={s.id}>{s.goal || `PRD ${s.id.slice(0, 8)}`}</option>)}
                </Select>
              )}
            </div>
          </>
        ) : (
          <>No PRD has been drafted for this project yet. Use Brain or the PRDs tab to draft one — agents use it to hand
            off work between swimlanes.</>
        )}
        {createModal}
      </div>
    );
  }

  const prd = selected?.prd ?? '';
  const body = (
    <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-primary)' }}>
      {view === 'raw' ? (
        <pre style={{
          margin: 0, padding: '12px 14px', borderRadius: 8, border: '1px solid var(--border-subtle)',
          background: 'var(--bg-elevated)', color: 'var(--text-primary)', overflowX: 'auto',
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: '0.78rem', lineHeight: 1.6, whiteSpace: 'pre-wrap',
        }}>
          {prd}
        </pre>
      ) : (
        <ChatMessageContent content={unwrapMarkdownFence(prd)} />
      )}
    </div>
  );

  const viewToggle = (
    <ViewToggle
      value={view}
      onChange={setView}
      options={[{ value: 'preview', label: 'Preview' }, { value: 'raw', label: 'RAW' }]}
    />
  );

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        {specs.length > 1 ? (
          <Select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} style={{ ...selectStyle, flex: 1 }}>
            {specs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.isPrimary ? '★ ' : ''}{s.goal || `PRD ${s.id.slice(0, 8)}`} ({s.status})
              </option>
            ))}
          </Select>
        ) : (
          <div style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>
            {selected?.isPrimary ? '★ ' : ''}{selected?.goal || 'PRD'}
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}> · {selected?.status}</span>
          </div>
        )}
        {viewToggle}
        <button type="button" style={iconBtn} title="Expand to full screen" aria-label="Expand to full screen" onClick={() => setFullscreen(true)}>
          <ExpandIcon />
        </button>
      </div>

      {/* Task-mode link controls */}
      {taskId != null && selected && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {!selected.isPrimary && (
            <button type="button" style={{ ...textBtn, opacity: busy ? 0.6 : 1 }} disabled={busy}
              onClick={() => run(() => taskSpecsApi.setPrimary(taskId, selected.id))}>Set primary</button>
          )}
          <button type="button" style={{ ...textBtn, opacity: busy ? 0.6 : 1 }} disabled={busy}
            onClick={() => run(() => taskSpecsApi.detach(taskId, selected.id))}>Detach</button>
          <button type="button" style={{ ...textBtn, opacity: busy ? 0.6 : 1 }} disabled={busy}
            onClick={() => setShowCreate(true)}>Create PRD</button>
          {linkable.length > 0 && (
            <Select style={selectStyle} value="" disabled={busy}
              onChange={(e) => e.target.value && run(() => taskSpecsApi.attach(taskId, e.target.value))}>
              <option value="">Attach existing PRD…</option>
              {linkable.map((s) => <option key={s.id} value={s.id}>{s.goal || `PRD ${s.id.slice(0, 8)}`}</option>)}
            </Select>
          )}
        </div>
      )}

      {createModal}
      {body}

      {fullscreen && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: 'fixed', inset: 0, zIndex: 10010, background: 'var(--bg-base)', display: 'flex', flexDirection: 'column' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{selected?.goal || 'PRD'}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {viewToggle}
            <button type="button" style={iconBtn} aria-label="Close full screen" onClick={() => setFullscreen(false)}>
              <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, stroke: 'currentColor', fill: 'none', strokeWidth: 2 }}>
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            </div>
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
