// No `'use client'`: imported only by client components (the two composers), so it is already on the client side of the boundary.

import { memo, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import { clearPreviewPick, previewPickExcerpt, usePreviewPick } from '@/lib/workspace/previewPick';

/**
 * The element picked in a live preview, as a chip in the composer's tool row — what the
 * next request is about. × withdraws it, and the request goes back to meaning the whole
 * app. Renders nothing while nothing is picked, so every composer that hosts a preview
 * can carry it unconditionally (the canvas prompt and the Studio workspace's Brain).
 */
export const PreviewPickChip = memo(function PreviewPickChip() {
  const t = useTranslations('ide.previewPick');
  const pick = usePreviewPick();
  if (!pick) return null;
  const excerpt = previewPickExcerpt(pick.text, 28);
  const label = excerpt ? t('labelWithText', { tag: pick.tag, text: excerpt }) : t('label', { tag: pick.tag });
  const where = t('where', { file: pick.file, line: pick.line });
  return (
    <span style={chipStyle} title={where} data-testid="preview-pick-chip">
      <Icon name="cursor" size={13} />
      <span style={labelStyle}>
        <span className="sr-only">{t('aria')} </span>
        {label}
      </span>
      <button type="button" style={removeStyle} onClick={() => clearPreviewPick()} aria-label={t('remove')} title={t('remove')}>
        <Icon name="close" size={12} />
      </button>
    </span>
  );
});

/** Accent-tinted from theme tokens, so it reads in light and dark; it shrinks rather than overflowing a phone row. */
const chipStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, maxWidth: '100%',
  height: 'var(--chat-ctl-size, 32px)', padding: '0 4px 0 10px', borderRadius: 'var(--radius-md)',
  background: 'var(--accent-subtle)',
  color: 'var(--text-primary)', fontSize: 'var(--font-size-small)', fontWeight: 600,
};

const labelStyle: CSSProperties = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

const removeStyle: CSSProperties = {
  flexShrink: 0, width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  border: 0, borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer',
};
