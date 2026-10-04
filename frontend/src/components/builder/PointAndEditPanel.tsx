// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import type { CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import type { PointAndEdit } from './usePointAndEdit';

/**
 * The edit form for an element picked in the preview: its copy and its classes,
 * applied as one exact source line. Renders nothing until something is picked —
 * arming the picker lives in the preview toolbar.
 */
export function PointAndEditPanel({ edit }: { edit: PointAndEdit }) {
  const t = useTranslations('ide');
  const { selection, draft, setDraft, error, apply, cancel } = edit;
  if (!selection) return null;

  return (
    <div
      style={{
        flexShrink: 0, borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)',
        padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8,
      }}
    >
      <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>
        {t('visualSelected', { tag: selection.tag, file: selection.file, line: selection.line })}
      </span>
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))' }}>
        {selection.text !== null && (
          <label style={labelStyle}>
            {t('visualText')}
            <input value={draft.text} onChange={(event) => setDraft((d) => ({ ...d, text: event.target.value }))} style={fieldStyle} />
          </label>
        )}
        <label style={labelStyle}>
          {t('visualClasses')}
          <input value={draft.className} onChange={(event) => setDraft((d) => ({ ...d, className: event.target.value }))} style={fieldStyle} />
        </label>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button type="button" variant="primary" size="sm" onClick={() => { void apply(); }}>{t('visualApply')}</Button>
        <Button type="button" variant="secondary" size="sm" onClick={cancel}>{t('visualCancel')}</Button>
        {error && <span role="alert" style={{ fontSize: 'var(--font-size-small)', color: 'var(--error)' }}>{error}</span>}
      </div>
    </div>
  );
}

const labelStyle: CSSProperties = { display: 'grid', gap: 4, fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' };

/** Theme tokens only, and fluid, so the row wraps rather than overflowing on a phone. */
const fieldStyle: CSSProperties = {
  width: '100%', minWidth: 0, padding: '6px 8px', fontSize: 'var(--font-size-small)', minHeight: 32,
  borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)',
  background: 'var(--bg-deep)', color: 'var(--text-primary)',
};
