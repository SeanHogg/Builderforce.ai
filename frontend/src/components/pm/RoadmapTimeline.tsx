'use client';

import { useState } from 'react';
import type { TrackerRow } from '@/lib/builderforceApi';
import { usePmScope } from '@/lib/pm/scope';
import { usePmData } from '@/lib/pm/usePmData';
import { roadmapClient, ROADMAP_HORIZONS, rstr } from '@/lib/pm/roadmap';
import { PmEmpty, PmError, StatusPill } from './pmShared';
import { RoadmapItemPanel } from './RoadmapItemPanel';

/**
 * Roadmap "now / next / later" horizon swimlanes from roadmap_items. Create via
 * "Add item", edit by clicking a card, delete via the card ×. All CRUD flows
 * through the shared RoadmapItemPanel (DRY with the Gantt view). Project view
 * (scoped) or portfolio (all segment rows) per the active PM scope.
 */
export function RoadmapTimeline() {
  const { projectId } = usePmScope();
  const { data, error, reload } = usePmData<TrackerRow[]>(
    () => roadmapClient.list(projectId ?? undefined),
    [projectId],
  );

  // Panel state: undefined = closed, null = create, row = edit.
  const [editing, setEditing] = useState<TrackerRow | null | undefined>(undefined);

  const remove = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!window.confirm('Delete this roadmap item?')) return;
    try { await roadmapClient.remove(id); reload(); } catch { /* surfaced on next load */ }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <button
          type="button"
          onClick={() => setEditing(null)}
          style={{ padding: '6px 14px', borderRadius: 6, border: 'none', background: 'var(--coral-bright)', color: '#fff', fontWeight: 600, cursor: 'pointer' }}
        >
          + Add item
        </button>
      </div>

      {error ? (
        <PmError message={error} />
      ) : !data ? (
        <PmEmpty message="Loading roadmap…" />
      ) : !data.length ? (
        <PmEmpty message="No roadmap items yet. Use “Add item” to create one." />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 16 }}>
          {ROADMAP_HORIZONS.map(({ key, label }) => {
            const items = data.filter((r) => (rstr(r, 'horizon') || 'now') === key);
            return (
              <div key={key} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 12, padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700 }}>{label}</h4>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{items.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {items.length === 0 && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>—</div>}
                  {items.map((r) => (
                    <button
                      key={String(r.id)}
                      type="button"
                      onClick={() => setEditing(r)}
                      style={{ textAlign: 'left', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '10px 12px', background: 'transparent', cursor: 'pointer', color: 'var(--text-primary)' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.86rem' }}>{rstr(r, 'title')}</div>
                        <span role="button" tabIndex={0} aria-label="Delete item" title="Delete" onClick={(e) => remove(e, String(r.id))} style={{ color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>×</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <StatusPill value={rstr(r, 'status') || 'planned'} />
                        {rstr(r, 'theme') && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{rstr(r, 'theme')}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <RoadmapItemPanel
        open={editing !== undefined}
        item={editing ?? null}
        projectId={projectId}
        onClose={() => setEditing(undefined)}
        onSaved={reload}
      />
    </div>
  );
}
