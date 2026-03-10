'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { specsApi, type Spec } from '@/lib/builderforceApi';
import { ChatMessageContent } from './ChatMessageContent';
import { ConfirmDialog } from './ConfirmDialog';

export interface PRDsContentProps {
  projectId: number;
  projectName: string;
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  reviewed: 'Reviewed',
  approved: 'Approved',
  in_progress: 'In progress',
  done: 'Done',
};

export function PRDsContent({ projectId, projectName }: PRDsContentProps) {
  const [specs, setSpecs] = useState<Spec[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
  const [showAddModal, setShowAddModal] = useState(false);
  const [addGoal, setAddGoal] = useState('');
  const [addPrd, setAddPrd] = useState('');
  const [addPreview, setAddPreview] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
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
      setError(e instanceof Error ? e.message : 'Failed to load PRDs');
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadSpecs();
  }, [loadSpecs]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addGoal.trim()) return;
    setIsCreating(true);
    setError(null);
    try {
      const spec = await specsApi.create({
        projectId,
        goal: addGoal.trim(),
        prd: addPrd.trim() || null,
        status: 'draft',
      });
      setSpecs((prev) => [spec, ...prev]);
      setShowAddModal(false);
      setAddGoal('');
      setAddPrd('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create PRD');
    } finally {
      setIsCreating(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!selectedSpec) return;
    setIsSaving(true);
    setError(null);
    try {
      const updated = await specsApi.patch(selectedSpec.id, { prd: editPrd.trim() || null });
      setSpecs((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
      setSelectedSpec(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
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
      setError(e instanceof Error ? e.message : 'Failed to delete');
    }
  };

  const openEdit = (spec: Spec) => {
    setSelectedSpec(spec);
    setEditPrd(spec.prd ?? '');
    setEditPreview(true);
  };

  const brainstormUrl = `/brainstorm?projectId=${projectId}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h3 style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>PRDs</h3>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Product requirements documents. Create in markdown or generate with Brain.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: 2 }}>
            <button
              type="button"
              onClick={() => setViewMode('card')}
              style={{
                padding: '6px 12px',
                fontSize: '0.8rem',
                fontWeight: 600,
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                background: viewMode === 'card' ? 'var(--coral-bright)' : 'transparent',
                color: viewMode === 'card' ? '#fff' : 'var(--text-secondary)',
              }}
            >
              Card
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              style={{
                padding: '6px 12px',
                fontSize: '0.8rem',
                fontWeight: 600,
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                background: viewMode === 'list' ? 'var(--coral-bright)' : 'transparent',
                color: viewMode === 'list' ? '#fff' : 'var(--text-secondary)',
              }}
            >
              List
            </button>
          </div>
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
              borderRadius: 8,
              textDecoration: 'none',
            }}
          >
            Generate with Brain →
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
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              cursor: 'pointer',
              fontFamily: 'var(--font-display)',
            }}
          >
            + Add
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 14px', fontSize: 13, background: 'var(--error-bg)', border: '1px solid var(--error-border)', color: 'var(--error-text)', borderRadius: 8 }}>
          {error}
        </div>
      )}

      {isLoading ? (
        <div style={{ color: 'var(--text-muted)', padding: 24 }}>Loading PRDs…</div>
      ) : specs.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: 48,
            background: 'var(--bg-elevated)',
            borderRadius: 12,
            border: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 16 }}>📄</div>
          <p style={{ color: 'var(--text-secondary)', marginBottom: 8 }}>No PRDs yet.</p>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
            Add a PRD manually or generate one with Brain.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              style={{
                padding: '12px 24px',
                background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
                color: '#fff',
                border: 'none',
                borderRadius: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              + Add PRD
            </button>
            <Link
              href={brainstormUrl}
              style={{
                padding: '12px 24px',
                background: 'var(--surface-coral-soft)',
                color: 'var(--coral-bright)',
                border: '1px solid var(--border-accent)',
                borderRadius: 12,
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              Generate with Brain →
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
                borderRadius: 12,
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
                {STATUS_LABELS[spec.status] ?? spec.status}
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
                {spec.prd ? spec.prd.slice(0, 150) + (spec.prd.length > 150 ? '…' : '') : 'No content'}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left' }}>
                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>Goal</th>
                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>Status</th>
                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>Preview</th>
                <th style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--text-secondary)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {specs.map((spec) => (
                <tr key={spec.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '12px 16px', fontWeight: 500, color: 'var(--text-primary)' }}>{spec.goal}</td>
                  <td style={{ padding: '12px 16px', color: 'var(--text-secondary)' }}>
                    {STATUS_LABELS[spec.status] ?? spec.status}
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
                          borderRadius: 8,
                          cursor: 'pointer',
                        }}
                      >
                        Edit
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
                          borderRadius: 8,
                          cursor: 'pointer',
                        }}
                      >
                        Delete
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
        <div
          className="modal-overlay"
          role="presentation"
          style={{ zIndex: 10004, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={(e) => e.target === e.currentTarget && setShowAddModal(false)}
        >
          <div
            style={{
              background: 'var(--panel-drawer-bg)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 12,
              padding: 24,
              maxWidth: 720,
              width: '100%',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>New PRD</div>
            <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1, minHeight: 0 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Goal / Title *</label>
                <input
                  required
                  autoFocus
                  value={addGoal}
                  onChange={(e) => setAddGoal(e.target.value)}
                  placeholder="e.g. User authentication flow"
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    fontSize: 13,
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 8,
                    background: 'var(--bg-deep)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Content (Markdown)</label>
                  <button
                    type="button"
                    onClick={() => setAddPreview((p) => !p)}
                    style={{
                      fontSize: 12,
                      padding: '4px 8px',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 6,
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                    }}
                  >
                    {addPreview ? 'Edit' : 'Preview'}
                  </button>
                </div>
                <div style={{ flex: 1, minHeight: 200, display: 'grid', gridTemplateColumns: addPreview ? '1fr 1fr' : '1fr', gap: 12 }}>
                  <textarea
                    value={addPrd}
                    onChange={(e) => setAddPrd(e.target.value)}
                    placeholder="# Overview&#10;&#10;Describe the product requirements..."
                    style={{
                      width: '100%',
                      minHeight: 200,
                      padding: '10px 12px',
                      fontSize: 13,
                      fontFamily: 'var(--font-mono)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 8,
                      background: 'var(--bg-deep)',
                      color: 'var(--text-primary)',
                      resize: 'vertical',
                    }}
                  />
                  {addPreview && (
                    <div
                      style={{
                        minHeight: 200,
                        padding: 12,
                        background: 'var(--bg-deep)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 8,
                        overflow: 'auto',
                        fontSize: 13,
                      }}
                    >
                      <div className="chat-message-markdown">
                        {addPrd ? <ChatMessageContent content={addPrd} /> : <span style={{ color: 'var(--text-muted)' }}>Preview will appear here</span>}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => { setShowAddModal(false); setAddGoal(''); setAddPrd(''); }}
                  style={{ padding: '8px 16px', fontSize: 13, color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating || !addGoal.trim()}
                  style={{
                    padding: '8px 18px',
                    fontSize: 13,
                    fontWeight: 600,
                    background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 10,
                    cursor: isCreating || !addGoal.trim() ? 'not-allowed' : 'pointer',
                    opacity: isCreating || !addGoal.trim() ? 0.7 : 1,
                  }}
                >
                  {isCreating ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit / View PRD drawer */}
      {selectedSpec && (
        <div
          className="modal-overlay"
          role="presentation"
          style={{ zIndex: 10004, display: 'flex', alignItems: 'stretch', justifyContent: 'flex-end', padding: 0 }}
          onClick={(e) => e.target === e.currentTarget && setSelectedSpec(null)}
        >
          <div
            style={{
              background: 'var(--panel-drawer-bg)',
              borderLeft: '1px solid var(--border-subtle)',
              width: 'min(640px, 90vw)',
              maxHeight: '100vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottom: '1px solid var(--border-subtle)' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{selectedSpec.goal}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{STATUS_LABELS[selectedSpec.status] ?? selectedSpec.status}</div>
              </div>
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
                    borderRadius: 8,
                    cursor: 'pointer',
                  }}
                >
                  {editPreview ? 'Edit' : 'Preview'}
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
                    color: '#fff',
                    border: 'none',
                    borderRadius: 8,
                    cursor: isSaving ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isSaving ? 'Saving…' : 'Save'}
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
                    borderRadius: 8,
                    cursor: 'pointer',
                  }}
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedSpec(null)}
                  aria-label="Close"
                  style={{
                    width: 36,
                    height: 36,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 8,
                    background: 'var(--bg-base)',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  <svg viewBox="0 0 24 24" style={{ width: 18, height: 18, stroke: 'currentColor', fill: 'none', strokeWidth: 2 }}>
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
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
                    borderRadius: 8,
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
                      borderRadius: 8,
                      overflow: 'auto',
                      fontSize: 13,
                    }}
                  >
                    <div className="chat-message-markdown">
                      {editPrd ? <ChatMessageContent content={editPrd} /> : <span style={{ color: 'var(--text-muted)' }}>Preview</span>}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteSpec}
        message={deleteSpec ? `Delete PRD "${deleteSpec.goal}"? This cannot be undone.` : ''}
        onCancel={() => setDeleteSpec(null)}
        onConfirm={handleDelete}
        confirmLabel="Delete"
      />
    </div>
  );
}
