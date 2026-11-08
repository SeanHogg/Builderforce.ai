import { useRef } from 'react';
import { Icon } from '@/components/ui/Icon';
import type { BlockRendererProps } from './blockRenderers';
import { gutterButtonStyle } from './blockStyles';

/** Image, video and file blocks: one card, shaped by the block's type. */
export function MediaBlockCard({ block, onFocus, onReplace, t }: BlockRendererProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const url = block.attrs.url;

  return (
    <div
      onClick={onFocus}
      style={{
        flex: 1,
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        background: 'var(--surface-2)',
        padding: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      {block.type === 'image' && url ? (
        // eslint-disable-next-line @next/next/no-img-element -- an uploaded asset, not a Next-optimizable local one
        // An upload's size is unknown until it loads, so it gets the block's own fixed box
        // (the old max bounds) and `contain` letterboxes it — no reflow when it arrives.
        <img src={url} alt={block.attrs.label ?? ''} width={260} height={160} style={{ maxWidth: '100%', borderRadius: 'var(--radius-sm)', objectFit: 'contain' }} />
      ) : block.type === 'video' && url ? (
        <video src={url} controls style={{ maxHeight: 200, maxWidth: 320, borderRadius: 'var(--radius-sm)' }} />
      ) : (
        <span style={{ fontSize: 'var(--font-size-section)' }}><Icon source="📄" size="1em" /></span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--font-size-small)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {block.attrs.label || url || t('blockEmptyMedia')}
        </div>
        {!url && <div style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>{t('blockUploadPrompt')}</div>}
      </div>
      <button type="button" onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }} style={gutterButtonStyle} title={t('blockReplace')}>
        <Icon source="⤒" size="0.9em" />
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={block.type === 'image' ? 'image/*' : block.type === 'video' ? 'video/*' : undefined}
        style={{ display: 'none' }}
        onChange={(e) => { const file = e.target.files?.[0]; if (file) onReplace(file); e.target.value = ''; }}
      />
    </div>
  );
}
