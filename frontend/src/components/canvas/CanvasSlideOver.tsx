'use client';

import { useTranslations } from 'next-intl';
import { CanvasBoard } from './CanvasBoard';
import type { CanvasModel } from './canvasModel';

/**
 * Reusable right-side slide-out that hosts a <CanvasBoard>. Built so the AI Brain
 * and Brainstorm surfaces can generate a canvas dynamically and show the result
 * in a panel without re-implementing board chrome. Presentation only — the caller
 * owns the model + persistence and toggles `open`.
 */
export interface CanvasSlideOverProps {
  open: boolean;
  onClose: () => void;
  title: string;
  value: CanvasModel;
  onChange?: (next: CanvasModel) => void;
  readOnly?: boolean;
  /** Optional node rendered in the header (e.g. a "Save to Knowledge" action). */
  actions?: React.ReactNode;
}

export function CanvasSlideOver({ open, onClose, title, value, onChange, readOnly, actions }: CanvasSlideOverProps) {
  const t = useTranslations('canvas');
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{ position: 'fixed', inset: 0, zIndex: 1200, display: 'flex', justifyContent: 'flex-end' }}
    >
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)' }} />
      <aside
        style={{
          position: 'relative',
          width: 'min(880px, 92vw)',
          height: '100%',
          background: 'var(--surface, #161616)',
          borderLeft: '1px solid var(--border, #333)',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '-12px 0 40px rgba(0,0,0,0.4)',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '12px 16px',
            borderBottom: '1px solid var(--border, #333)',
          }}
        >
          <strong style={{ fontSize: 15 }}>{title}</strong>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {actions}
            <button
              type="button"
              onClick={onClose}
              aria-label={t('close')}
              style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}
            >
              ×
            </button>
          </div>
        </header>
        <div style={{ flex: 1, minHeight: 0, padding: 16, overflow: 'auto' }}>
          <CanvasBoard value={value} onChange={onChange} readOnly={readOnly} height="100%" />
        </div>
      </aside>
    </div>
  );
}
