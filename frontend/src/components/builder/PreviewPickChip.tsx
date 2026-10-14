// No `'use client'`: imported only by client components (the two composers), so it is already on the client side of the boundary.

import { memo, useEffect, useRef, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import {
  previewPickExcerpt,
  previewPickKey,
  removePreviewPick,
  usePreviewPicks,
  type PreviewPick,
} from '@/lib/workspace/previewPick';

/**
 * The elements picked for the next request, as chips in the composer's tool row — one
 * per pick: an element clicked in a live preview (source-anchored), or an element a
 * fix changes (selector-anchored, from Insights' "Apply in composer"). Each chip's ×
 * withdraws that one pick. Renders nothing while nothing is picked, so every composer
 * that hosts a preview can carry it unconditionally (the canvas prompt and the Studio
 * workspace's Brain).
 *
 * New picks put the caret in THIS composer: the person just pointed at something, and
 * the next thing they do is say what to change about it.
 */
export const PreviewPickChips = memo(function PreviewPickChips() {
  const picks = usePreviewPicks();
  const rowRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (picks.length === 0) return;
    const box = rowRef.current?.closest('form')?.querySelector('textarea');
    if (!box) return;
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }, [picks]);
  if (picks.length === 0) return null;
  return (
    <span ref={rowRef} style={rowStyle}>
      {picks.map((pick) => <PreviewPickChip key={previewPickKey(pick)} pick={pick} />)}
    </span>
  );
});

function PreviewPickChip({ pick }: { pick: PreviewPick }) {
  const t = useTranslations('ide.previewPick');
  const a = pick.anchor;
  let label: string;
  let where: string;
  if (a.kind === 'selector') {
    label = previewPickExcerpt(a.label, 28) ?? previewPickExcerpt(a.selector, 28) ?? a.selector;
    where = t('whereSelector', { selector: a.selector, page: a.pagePath });
  } else {
    const excerpt = previewPickExcerpt(a.text, 28);
    label = excerpt ? t('labelWithText', { tag: a.tag, text: excerpt }) : t('label', { tag: a.tag });
    where = t('where', { file: a.file, line: a.line });
  }
  return (
    <span style={chipStyle} title={where} data-testid="preview-pick-chip" data-anchor={a.kind}>
      <Icon name="cursor" size={13} />
      <span style={labelStyle}>
        <span className="sr-only">{t('aria')} </span>
        {label}
      </span>
      <button type="button" style={removeStyle} onClick={() => removePreviewPick(pick)} aria-label={t('remove')} title={t('remove')}>
        <Icon name="close" size={12} />
      </button>
    </span>
  );
}

/** The chips wrap rather than overflowing a phone row. */
const rowStyle: CSSProperties = { display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, minWidth: 0, maxWidth: '100%' };

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
