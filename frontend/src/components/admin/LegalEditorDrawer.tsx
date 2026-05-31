'use client';

import React, { useEffect, useState } from 'react';
import { adminApi, type LegalDocument } from '@/lib/adminApi';
import { useModalDismiss } from '@/hooks/useModalDismiss';

export interface LegalEditorContext {
  docType: 'terms' | 'privacy';
  mode: 'edit' | 'new';
  /** The current active document, used to pre-fill the form. */
  current: LegalDocument | null;
}

interface LegalEditorDrawerProps {
  context: LegalEditorContext | null;
  onClose: () => void;
  /** Called after a successful publish so the parent can refresh. */
  onPublished: () => void | Promise<void>;
}

const DOC_LABEL: Record<LegalEditorContext['docType'], string> = {
  terms: 'Terms of Use',
  privacy: 'Privacy Policy',
};

/** Bump the trailing numeric segment of a semver-ish version (1.0.0 -> 1.0.1). */
function bumpPatch(version: string): string {
  const parts = version.split('.');
  const last = parts.length - 1;
  const n = Number(parts[last]);
  if (!Number.isFinite(n)) return version;
  parts[last] = String(n + 1);
  return parts.join('.');
}

export function LegalEditorDrawer({ context, onClose, onPublished }: LegalEditorDrawerProps) {
  const [version, setVersion] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');

  // Locks body scroll + closes on Escape while the drawer is open.
  useModalDismiss(!!context, onClose);

  // Re-seed the form whenever a new editor context opens.
  useEffect(() => {
    if (!context) return;
    setError('');
    const cur = context.current;
    if (context.mode === 'edit' && cur) {
      setVersion(cur.version);
      setTitle(cur.title);
      setContent(cur.content);
    } else {
      // New version: suggest the next patch and carry over the title.
      setVersion(cur ? bumpPatch(cur.version) : '1.0.0');
      setTitle(cur?.title || DOC_LABEL[context.docType]);
      setContent('');
    }
  }, [context]);

  if (!context) return null;

  const label = DOC_LABEL[context.docType];
  const canPublish = version.trim().length > 0 && content.trim().length > 0;

  const handlePublish = async () => {
    if (!canPublish) {
      setError('Version and content are required.');
      return;
    }
    setPublishing(true);
    setError('');
    try {
      await adminApi.publishLegal(context.docType, {
        version: version.trim(),
        title: title.trim() || label,
        content: content.trim(),
      });
      await onPublished();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPublishing(false);
    }
  };

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000 }}
      />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(640px, 100%)',
          background: 'var(--surface, #0f1320)',
          borderLeft: '1px solid var(--border, #232a3d)',
          boxShadow: '-8px 0 40px rgba(0,0,0,0.5)',
          zIndex: 1001,
          overflowY: 'auto',
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20 }}>
              {context.mode === 'edit' ? 'Edit' : 'New version'} · {label}
            </h2>
            <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
              {context.mode === 'edit'
                ? 'Amend the current document, then publish to make it active.'
                : 'Draft a new version. Publishing makes it the active document.'}
            </div>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost">✕ Close</button>
        </div>

        {error && <div className="admin-error">{error}</div>}

        <div>
          <div className="health-label" style={{ marginBottom: 4 }}>Version</div>
          <input
            type="text"
            placeholder="e.g. 1.0.1"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            className="admin-select"
            style={{ width: '100%' }}
          />
        </div>

        <div>
          <div className="health-label" style={{ marginBottom: 4 }}>Title</div>
          <input
            type="text"
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="admin-select"
            style={{ width: '100%' }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <div className="health-label" style={{ marginBottom: 4 }}>Content (full text)</div>
          <textarea
            placeholder="Full document text"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="admin-token-textarea"
            style={{ minHeight: 280, flex: 1 }}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn-ghost" onClick={onClose} disabled={publishing}>
            Cancel
          </button>
          <button
            type="button"
            className="admin-tab active"
            onClick={handlePublish}
            disabled={publishing || !canPublish}
          >
            {publishing ? 'Publishing…' : 'Publish as active'}
          </button>
        </div>
      </div>
    </>
  );
}
