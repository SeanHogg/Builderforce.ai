'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from '@/components/SlideOutPanel';
import { specsApi, type Spec } from '@/lib/builderforceApi';
import { ChatMessageContent } from '../ChatMessageContent';

/**
 * Shared "create a project-level PRD" modal (goal + markdown editor with live
 * preview). Used by both the project PRDs tab and the task PRD tab so the create
 * flow lives in one place. The PRD is always created at PROJECT level; callers
 * decide what to do with the new spec via `onCreated` (e.g. link it to a task).
 */
export function PrdCreateModal({
  projectId,
  onCreated,
  onClose,
}: {
  projectId: number;
  onCreated: (spec: Spec) => void | Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations('prdCreate');
  const tc = useTranslations('common');
  const [goal, setGoal] = useState('');
  const [prd, setPrd] = useState('');
  const [preview, setPreview] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!goal.trim()) return;
    setIsCreating(true);
    setError(null);
    try {
      const spec = await specsApi.create({ projectId, goal: goal.trim(), prd: prd.trim() || null, status: 'draft' });
      await onCreated(spec);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('createError'));
      setIsCreating(false);
    }
  };

  return (
    <SlideOutPanel open onClose={onClose} title={t('title')} width="min(720px, 96vw)">
      <div
        style={{
          padding: 20,
          height: '100%',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {error && (
          <div style={{ padding: '10px 14px', fontSize: 13, background: 'var(--error-bg)', border: '1px solid var(--error-border)', color: 'var(--error-text)', borderRadius: 8, marginBottom: 12 }}>
            {error}
          </div>
        )}
        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1, minHeight: 0 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{t('goalLabel')}</label>
            <input
              required
              autoFocus
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder={t('goalPlaceholder')}
              style={{
                width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid var(--border-subtle)',
                borderRadius: 8, background: 'var(--bg-deep)', color: 'var(--text-primary)',
              }}
            />
          </div>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('contentLabel')}</label>
              <button
                type="button"
                onClick={() => setPreview((p) => !p)}
                style={{ fontSize: 12, padding: '4px 8px', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                {preview ? tc('edit') : t('preview')}
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 200, display: 'grid', gridTemplateColumns: preview ? '1fr 1fr' : '1fr', gap: 12 }}>
              <textarea
                value={prd}
                onChange={(e) => setPrd(e.target.value)}
                placeholder={t('contentPlaceholder')}
                style={{
                  width: '100%', minHeight: 200, padding: '10px 12px', fontSize: 13, fontFamily: 'var(--font-mono)',
                  border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--bg-deep)',
                  color: 'var(--text-primary)', resize: 'vertical',
                }}
              />
              {preview && (
                <div style={{ minHeight: 200, padding: 12, background: 'var(--bg-deep)', border: '1px solid var(--border-subtle)', borderRadius: 8, overflow: 'auto', fontSize: 13 }}>
                  <div className="chat-message-markdown">
                    {prd ? <ChatMessageContent content={prd} /> : <span style={{ color: 'var(--text-muted)' }}>{t('previewPlaceholder')}</span>}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="button" onClick={onClose} style={{ padding: '8px 16px', fontSize: 13, color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}>
              {tc('cancel')}
            </button>
            <button
              type="submit"
              disabled={isCreating || !goal.trim()}
              style={{
                padding: '8px 18px', fontSize: 13, fontWeight: 600,
                background: 'linear-gradient(135deg, var(--coral-bright), var(--coral-dark))', color: '#fff',
                border: 'none', borderRadius: 10,
                cursor: isCreating || !goal.trim() ? 'not-allowed' : 'pointer', opacity: isCreating || !goal.trim() ? 0.7 : 1,
              }}
            >
              {isCreating ? t('creating') : t('create')}
            </button>
          </div>
        </form>
      </div>
    </SlideOutPanel>
  );
}
