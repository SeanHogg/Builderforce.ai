'use client';

import React, { useEffect, useState } from 'react';
import { adminApi, type LegalDocument } from '@/lib/adminApi';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { LegalDocPreview } from '@/components/admin/LegalDocPreview';
import { unwrapLegalMarkdown } from '@/lib/utils';

export interface LegalEditorContext {
  docType: 'terms' | 'privacy';
  mode: 'edit' | 'new';
  /** The current active document, used to pre-fill the form. */
  current: LegalDocument | null;
}

interface LegalEditorDrawerProps {
  context: LegalEditorContext | null;
  onClose: () => void;
  /** Called after a successful save so the parent can refresh. */
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(false);

  // Re-seed the form whenever a new editor context opens.
  useEffect(() => {
    if (!context) return;
    setError('');
    setPreview(false);
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

  const docType = context?.docType ?? 'terms';
  const mode = context?.mode ?? 'new';
  const label = DOC_LABEL[docType];
  const canSave = version.trim().length > 0 && content.trim().length > 0;

  const handleSave = async () => {
    if (!context || !canSave) {
      setError('Version and content are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        version: version.trim(),
        title: title.trim() || label,
        // Normalize on WRITE so the stored value is clean for every consumer
        // (API/exports/Copy), not just the render path. Idempotent — already-
        // clean prose passes through unchanged [1328].
        content: unwrapLegalMarkdown(content).trim(),
      };
      if (mode === 'edit') {
        await adminApi.amendLegal(context.docType, payload);
      } else {
        await adminApi.publishLegal(context.docType, payload);
      }
      await onPublished();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SlideOutPanel
      open={!!context}
      onClose={onClose}
      title={`${mode === 'edit' ? 'Edit' : 'New version'} · ${label}`}
      width="min(680px, 96vw)"
      headerActions={
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setPreview((p) => !p)}
          disabled={!content.trim()}
        >
          {preview ? '✎ Edit' : '👁 Preview'}
        </button>
      }
    >
      {context && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>
          <div className="text-muted" style={{ fontSize: 12 }}>
            {mode === 'edit'
              ? 'Amend the active document in place (no new version is minted unless you change the version number).'
              : 'Draft a new version. Publishing makes it the active document. Markdown is supported.'}
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

          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 220 }}>
            <div className="health-label" style={{ marginBottom: 4 }}>
              Content (Markdown){preview ? ' — preview' : ''}
            </div>
            {preview ? (
              <div
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 8,
                  padding: '8px 14px',
                  background: 'var(--bg-deep)',
                }}
              >
                <LegalDocPreview content={content} />
              </div>
            ) : (
              <textarea
                placeholder="Full document text (Markdown supported)"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="admin-token-textarea"
                style={{ flex: 1, minHeight: 220 }}
              />
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button
              type="button"
              className="admin-tab active"
              onClick={handleSave}
              disabled={saving || !canSave}
            >
              {saving
                ? 'Saving…'
                : mode === 'edit'
                  ? 'Save changes'
                  : 'Publish as active'}
            </button>
          </div>
        </div>
      )}
    </SlideOutPanel>
  );
}
