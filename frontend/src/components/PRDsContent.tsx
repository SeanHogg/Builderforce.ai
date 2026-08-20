'use client';

import { Icon } from '@/components/ui/Icon';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useBrainDataRefresh } from '@/lib/brain/useBrainDataRefresh';
import { specsApi, type Spec } from '@/lib/builderforceApi';
import { ChatMessageContent } from './ChatMessageContent';
import { ConfirmDialog } from './ConfirmDialog';
import { ViewToggle, type ViewMode } from '@/components/ViewToggle';
import { PrdCreateModal } from './prd/PrdCreateModal';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { tableWrapStyle, tableStyle } from './dataTableStyles';

export interface PRDsContentProps {
  projectId: number;
  projectName: string;
  /**
   * Open one spec's drawer as soon as the list has loaded, selected by kind —
   * how "View arch analysis" lands ON the architecture PRD instead of merely on
   * the tab that contains it. Consumed once (see `onInitialSpecConsumed`), so a
   * re-render never re-opens a drawer the user has closed.
   */
  initialSpecKind?: string | null;
  /** Same, but by exact id — wins over `initialSpecKind` when both are given. */
  initialSpecId?: string | null;
  /** Fired once the request above has been acted on, so the owner can clear it. */
  onInitialSpecConsumed?: () => void;
}

export function PRDsContent({
  projectId,
  projectName,
  initialSpecKind = null,
  initialSpecId = null,
  onInitialSpecConsumed,
}: PRDsContentProps) {
  const t = useTranslations('prdsDrawer');
  const tc = useTranslations('common');
  /** Localized spec status; unknown values fall back to the raw string. */
  const statusLabel = (status: string): string => {
    const labels: Record<string, string> = {
      draft: t('statusDraft'),
      ready: t('statusReady'),
      in_progress: t('statusInProgress'),
      complete: t('statusComplete'),
    };
    return labels[status] ?? status;
  };
  const [specs, setSpecs] = useState<Spec[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('card');
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedSpec, setSelectedSpec] = useState<Spec | null>(null);
  const [editPrd, setEditPrd] = useState('');
  const [editPreview, setEditPreview] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteSpec, setDeleteSpec] = useState<Spec | null>(null);

  const loadSpecs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const list = await specsApi.list(projectId);
      setSpecs(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('loadFailed'));
    } finally {
      setIsLoading(false);
    }
    // `t` is memoized per namespace by next-intl, so listing it is honest about
    // the dependency without turning this into a refetch-every-render loop.
  }, [projectId, t]);

  useEffect(() => {
    loadSpecs();
  }, [loadSpecs]);

  // Refetch when the Brain creates/updates/deletes a spec/PRD so this list stays
  // live instead of going stale until a manual reload.
  useBrainDataRefresh(['specs'], loadSpecs);

  const handleSaveEdit = async () => {
    if (!selectedSpec) return;
    setIsSaving(true);
    setError(null);
    try {
      const updated = await specsApi.patch(selectedSpec.id, { prd: editPrd.trim() || null });
      setSpecs((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      setSelectedSpec(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('saveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteSpec) return;
    try {
      await specsApi.delete(deleteSpec.id);
      setSpecs((prev) => prev.filter((s) => s.id !== deleteSpec.id));
      setDeleteSpec(null);
      if (selectedSpec?.id === deleteSpec.id) setSelectedSpec(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('deleteFailed'));
    }
  };

  const openEdit = useCallback((spec: Spec) => {
    setSelectedSpec(spec);
    setEditPrd(spec.prd ?? '');
    setEditPreview(true);
  }, []);

  // A caller can ask for one spec's drawer to be open on arrival (the Architecture
  // "Fix" lands on the architecture PRD, not just the PRDs tab). The request is
  // CONSUMED — recorded in a ref and reported back — so closing the drawer sticks
  // instead of the next render re-opening it, and a request that matches nothing
  // is retired rather than retried against every refetch of the list.
  const consumedSpecRequest = useRef<string | null>(null);
  useEffect(() => {
    const request = initialSpecId ?? initialSpecKind ?? null;
    if (!request || isLoading) return;
    if (consumedSpecRequest.current === request) return;
    consumedSpecRequest.current = request;
    const match = initialSpecId
      ? specs.find((s) => s.id === initialSpecId)
      : specs.find((s) => s.kind === initialSpecKind);
    if (match) openEdit(match);
    onInitialSpecConsumed?.();
  }, [initialSpecId, initialSpecKind, isLoading, specs, openEdit, onInitialSpecConsumed]);

  // `?project=` is the global scope param adopted by ProjectScopeProvider on
  // navigation, so the Brain Storm filter (and new-chat default) lands on this
  // project — one picker for the whole app.
  const brainstormUrl = `/brainstorm?project=${projectId}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h3 style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>{t('title')}</h3>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {t('subtitle')}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <ViewToggle value={viewMode} onChange={setViewMode} />
          <Link
            href={brainstormUrl}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 600,
              background: 'var(--surface-coral-soft)',
              color: 'var(--coral-bright)',
              border: '1px solid var(--border-accent)',
              borderRadius: 'var(--radius-md)',
              textDecoration: 'none',
            }}
          >
            {t('generateWithBrain')} →
          </Link>
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 18px',
              fontSize: '0.875rem',
              fontWeight: 600,
              background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
              color: 'var(--text-on-accent)',
              border: 'none',
              borderRadius: 'var(--radius-lg)',
              cursor: 'pointer',
              fontFamily: 'var(--font-display)',
            }}
          >
            + {t('add')}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', fontSize: 13, background: 'var(--error-bg)', border: '1px solid var(--error-border)', color: 'var(--error-text)', borderRadius: 'var(--radius-md)' }}>
          {error}
        </div>
      )}

      {isLoading ? (
        <div style={{ color: 'var(--text-muted)', padding: 24 }}>{t('loading')}</div>
      ) : specs.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: 48,
            background: 'var(--bg-elevated)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 16 }}><Icon source="📄" size="1em" /></div>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 8 }}>{t('emptyTitle')}</p>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
            {t('emptyDesc')}
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              style={{
                padding: '12px 24px',
                background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
                color: 'var(--text-on-accent)',
                border: 'none',
                borderRadius: 'var(--radius-lg)',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              + {t('addPrd')}
            </button>
            <Link
              href={brainstormUrl}
              style={{
                padding: '12px 24px',
                background: 'var(--surface-coral-soft)',
                color: 'var(--coral-bright)',
                border: '1px solid var(--border-accent)',
                borderRadius: 'var(--radius-lg)',
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              {t('generateWithBrain')} →
            </Link>
          </div>
        </div>
      ) : viewMode === 'card' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {specs.map((spec) => (
            <div
              key={spec.id}
              style={{
                background: 'var(--bg-base)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-lg)',
                padding: 16,
                cursor: 'pointer',
                transition: 'border-color 0.2s',
              }}
              onClick={() => openEdit(spec)}
              onKeyDown={(e) => e.key === 'Enter' && openEdit(spec)}
              role="button"
              tabIndex={0}
            >
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{spec.goal}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                {statusLabel(spec.status)}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: '-webkit-box',
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: 'vertical',
                }}
              >
                {spec.prd ? spec.prd.slice(0, 150) + (spec.prd.length > 150 ? '…' : '') : t('noContent')}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={tableWrapStyle}>
          <table style={tableStyle}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left' }}>
                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>{t('colGoal')}</th>
                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>{t('colStatus')}</th>
                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>{t('preview')}</th>
                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>{t('colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {specs.map((spec) => (
                <tr key={spec.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 500, color: 'var(--text-primary)' }}>{spec.goal}</td>
                  <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>
                    {statusLabel(spec.status)}
                  </td>
                  <td style={{ padding: '12px 16px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {spec.prd ? spec.prd.slice(0, 80) + (spec.prd.length > 80 ? '…' : '') : '—'}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => openEdit(spec)}
                        style={{
                          padding: '6px 12px',
                          fontSize: 12,
                          fontWeight: 600,
                          color: 'var(--coral-bright)',
                          background: 'none',
                          border: '1px solid var(--coral-bright)',
                          borderRadius: 'var(--radius-md)',
                          cursor: 'pointer',
                        }}
                      >
                        {tc('edit')}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setDeleteSpec(spec); }}
                        style={{
                          padding: '6px 12px',
                          fontSize: 12,
                          fontWeight: 600,
                          color: 'var(--error-text)',
                          background: 'none',
                          border: '1px solid var(--error-border)',
                          borderRadius: 'var(--radius-md)',
                          cursor: 'pointer',
                        }}
                      >
                        {tc('delete')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add PRD modal */}
      {showAddModal && (
        <PrdCreateModal
          projectId={projectId}
          onClose={() => setShowAddModal(false)}
          onCreated={(spec) => { setSpecs((prev) => [spec, ...prev]); setShowAddModal(false); }}
        />
      )}

      {/* Edit / View PRD drawer */}
      <SlideOutPanel
        open={!!selectedSpec}
        onClose={() => setSelectedSpec(null)}
        width="min(1100px, 92vw)"
        title={selectedSpec && (
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{selectedSpec.goal}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{statusLabel(selectedSpec.status)}</div>
          </div>
        )}
        headerActions={selectedSpec && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={() => setEditPreview((p) => !p)}
              style={{
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: 600,
                background: 'var(--bg-elevated)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
              }}
            >
              {editPreview ? tc('edit') : t('preview')}
            </button>
            <button
              type="button"
              onClick={handleSaveEdit}
              disabled={isSaving}
              style={{
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: 600,
                background: 'var(--coral-bright)',
                color: 'var(--text-on-accent)',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                cursor: isSaving ? 'not-allowed' : 'pointer',
              }}
            >
              {isSaving ? tc('saving') : tc('save')}
            </button>
            <button
              type="button"
              onClick={() => setDeleteSpec(selectedSpec)}
              style={{
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--error-text)',
                background: 'none',
                border: '1px solid var(--error-border)',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
              }}
            >
              {tc('delete')}
            </button>
          </div>
        )}
      >
        <div style={{ padding: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: editPreview ? '1fr 1fr' : '1fr', gap: 16, minHeight: 300 }}>
            <textarea
              value={editPrd}
              onChange={(e) => setEditPrd(e.target.value)}
              style={{
                width: '100%',
                minHeight: 300,
                padding: '10px 12px',
                fontSize: 13,
                fontFamily: 'var(--font-mono)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-deep)',
                color: 'var(--text-primary)',
                resize: 'vertical',
              }}
            />
            {editPreview && (
              <div
                style={{
                  minHeight: 300,
                  padding: 12,
                  background: 'var(--bg-deep)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                  overflow: 'auto',
                  fontSize: 13,
                }}
              >
                <div className="chat-message-markdown">
                  {editPrd ? <ChatMessageContent content={editPrd} /> : <span style={{ color: 'var(--text-muted)' }}>{t('preview')}</span>}
                </div>
              </div>
            )}
          </div>
        </div>
      </SlideOutPanel>

      <ConfirmDialog
        open={!!deleteSpec}
        message={deleteSpec ? t('deleteConfirm', { goal: deleteSpec.goal }) : ''}
        onCancel={() => setDeleteSpec(null)}
        onConfirm={handleDelete}
        confirmLabel={tc('delete')}
      />
    </div>
  );
}
