'use client';

import { useCallback, useRef, useState, type CSSProperties } from 'react';
import type { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import type { DocumentBlock } from '@/domains/collab/domain/blockDocument';
import { textBlockKind } from '@/domains/collab/domain/blockDocument';
import type { BlockDocument, BlockPeer } from '@/domains/collab/presentation/useBlockDocument';
import { uploadAsset, assetUrl } from '@/lib/assetsApi';

/**
 * A CO-EDITED DOCUMENT, RENDERED PER BLOCK.
 *
 * The whole reason a per-block editor exists rather than one `<textarea>` bound
 * to the document string: a `BlockDocument` (see
 * `domains/collab/presentation/useBlockDocument.ts`) makes a BLOCK the unit that
 * syncs and the unit a cursor belongs to. This component is the one place that
 * turns that into something a person can click, type into and drop a file onto.
 *
 * Media blocks (image/video/file) round-trip through the asset pipeline
 * (`lib/assetsApi.ts`) — the thing the roadmap called "URL-only": before this,
 * inserting an image meant already having a URL to paste. Now it is drag, drop,
 * or a toolbar button.
 */

export interface BlockEditorProps {
  doc: BlockDocument;
  t: ReturnType<typeof useTranslations>;
  readOnly?: boolean;
}

const rowStyle: CSSProperties = {
  position: 'relative',
  display: 'flex',
  gap: 8,
  alignItems: 'flex-start',
  padding: '4px 0',
};

const gutterButtonStyle: CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'var(--text-muted)',
  cursor: 'pointer',
  fontSize: 'var(--font-size-eyebrow)',
  lineHeight: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

/** Peers currently in one block — the block-level cursor. */
function peersInBlock(peers: readonly BlockPeer[], blockId: string): BlockPeer[] {
  return peers.filter((peer) => peer.blockId === blockId);
}

/** The colored left rail + name chip that IS the block-level multi-cursor: whose
 *  presence is attributed to a block, not to an offset nobody but them can see. */
function BlockCursorRail({ peers }: { peers: readonly BlockPeer[] }) {
  if (peers.length === 0) return null;
  return (
    <div
      style={{
        position: 'absolute',
        left: -10,
        top: 0,
        bottom: 0,
        width: 3,
        borderRadius: 'var(--radius-sm)',
        background: peers[0]!.color,
      }}
      title={peers.map((peer) => peer.name).join(', ')}
    />
  );
}

function PeerChips({ peers }: { peers: readonly BlockPeer[] }) {
  if (peers.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: 4, position: 'absolute', right: 4, top: 4, zIndex: 1 }}>
      {peers.map((peer) => (
        <span
          key={peer.userId}
          title={peer.name}
          style={{
            fontSize: 10,
            fontWeight: 600,
            padding: '2px 6px',
            borderRadius: 'var(--radius-full)',
            background: peer.color,
            color: 'var(--text-on-accent)',
          }}
        >
          {peer.name}
        </span>
      ))}
    </div>
  );
}

/** Auto-growing so a paragraph and a heading do not share one fixed height —
 *  the height itself is the only thing that varies by kind. */
function TextBlockInput({
  block,
  onChange,
  onFocus,
  placeholder,
}: {
  block: DocumentBlock;
  onChange: (text: string) => void;
  onFocus: () => void;
  placeholder: string;
}) {
  const kind = textBlockKind(block.text);
  const fontSize = kind === 'heading' ? 18 : 14;
  const fontWeight = kind === 'heading' ? 700 : 400;
  const ref = useRef<HTMLTextAreaElement>(null);

  const autoGrow = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  return (
    <textarea
      ref={(el) => { ref.current = el; autoGrow(el); }}
      value={block.text}
      onChange={(e) => { onChange(e.target.value); autoGrow(e.target); }}
      onFocus={onFocus}
      placeholder={placeholder}
      rows={1}
      style={{
        flex: 1,
        width: '100%',
        resize: 'none',
        overflow: 'hidden',
        border: 'none',
        outline: 'none',
        background: 'transparent',
        color: 'inherit',
        fontFamily: kind === 'code' ? 'ui-monospace, monospace' : 'inherit',
        fontSize,
        fontWeight,
        lineHeight: 1.6,
        padding: '6px 4px',
      }}
    />
  );
}

function MediaBlockCard({
  block,
  onFocus,
  onReplace,
  t,
}: {
  block: DocumentBlock;
  onFocus: () => void;
  onReplace: (file: File) => void;
  t: ReturnType<typeof useTranslations>;
}) {
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
        <img src={url} alt={block.attrs.label ?? ''} style={{ maxHeight: 160, maxWidth: 260, borderRadius: 'var(--radius-sm)', objectFit: 'contain' }} />
      ) : block.type === 'video' && url ? (
        <video src={url} controls style={{ maxHeight: 200, maxWidth: 320, borderRadius: 'var(--radius-sm)' }} />
      ) : (
        <span style={{ fontSize: 24 }}><Icon source="📄" size="1em" /></span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {block.attrs.label || url || t('blockEmptyMedia')}
        </div>
        {!url && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('blockUploadPrompt')}</div>}
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

export function BlockEditor({ doc, t, readOnly }: BlockEditorProps) {
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const upload = useCallback(async (file: File, insertAfterId: string | null, replaceId?: string) => {
    const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : 'file';
    const placeholderId = replaceId ?? doc.insertAfter(insertAfterId, {
      id: `pending-${Date.now()}`, type: kind, text: '', attrs: { label: file.name },
    });
    setUploadingId(placeholderId);
    try {
      const uploaded = await uploadAsset(file);
      doc.setAttrs(placeholderId, { url: assetUrl(uploaded.key), label: file.name, mime: uploaded.type, size: uploaded.size });
    } catch {
      doc.setAttrs(placeholderId, { label: `${file.name} — ${t('blockUploadFailed')}` });
    } finally {
      setUploadingId(null);
    }
  }, [doc, t]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (readOnly) return;
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const lastId = doc.blocks[doc.blocks.length - 1]?.id ?? null;
    void upload(file, lastId);
  }, [doc, readOnly, upload]);

  return (
    <div
      onDragOver={(e) => { if (!readOnly) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      style={{
        border: `1px dashed ${dragOver ? 'var(--accent)' : 'transparent'}`,
        borderRadius: 'var(--radius-lg)',
        transition: 'border-color 120ms',
      }}
    >
      {doc.blocks.map((block, index) => {
        const peers = peersInBlock(doc.peers, block.id);
        const isLast = index === doc.blocks.length - 1;
        return (
          <div key={block.id} style={rowStyle}>
            <BlockCursorRail peers={peers} />
            {!readOnly && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 6 }}>
                <button type="button" style={gutterButtonStyle} title={t('blockMoveUp')} onClick={() => doc.move(block.id, -1)} disabled={index === 0}>
                  <Icon source="↑" size="0.8em" />
                </button>
                <button type="button" style={gutterButtonStyle} title={t('blockMoveDown')} onClick={() => doc.move(block.id, 1)} disabled={isLast}>
                  <Icon source="↓" size="0.8em" />
                </button>
              </div>
            )}
            <div style={{ position: 'relative', flex: 1 }}>
              <PeerChips peers={peers} />
              {block.type === 'text' ? (
                <TextBlockInput
                  block={block}
                  placeholder={index === 0 ? t('contentPlaceholder') : ''}
                  onFocus={() => doc.setFocusedBlock(block.id)}
                  onChange={(text) => doc.setText(block.id, text)}
                />
              ) : (
                <MediaBlockCard
                  block={block}
                  t={t}
                  onFocus={() => doc.setFocusedBlock(block.id)}
                  onReplace={(file) => void upload(file, null, block.id)}
                />
              )}
              {uploadingId === block.id && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('blockUploading')}</div>
              )}
            </div>
            {!readOnly && (
              <button
                type="button"
                style={gutterButtonStyle}
                title={t('blockDelete')}
                onClick={() => doc.remove(block.id)}
              >
                <Icon source="✕" size="0.8em" />
              </button>
            )}
          </div>
        );
      })}

      {!readOnly && (
        <BlockToolbar
          t={t}
          onAddText={() => doc.setFocusedBlock(doc.insertAfter(doc.blocks[doc.blocks.length - 1]?.id ?? null, { id: `t-${Date.now()}`, type: 'text', text: '', attrs: {} }))}
          onAddMedia={(file) => void upload(file, doc.blocks[doc.blocks.length - 1]?.id ?? null)}
        />
      )}
    </div>
  );
}

function BlockToolbar({
  t,
  onAddText,
  onAddMedia,
}: {
  t: ReturnType<typeof useTranslations>;
  onAddText: () => void;
  onAddMedia: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
      <button type="button" onClick={onAddText} style={{ ...gutterButtonStyle, width: 'auto', padding: '4px 10px' }}>
        + {t('blockAddText')}
      </button>
      <button type="button" onClick={() => inputRef.current?.click()} style={{ ...gutterButtonStyle, width: 'auto', padding: '4px 10px' }}>
        + {t('blockAddMedia')}
      </button>
      <input
        ref={inputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={(e) => { const file = e.target.files?.[0]; if (file) onAddMedia(file); e.target.value = ''; }}
      />
      <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>{t('blockDropHint')}</span>
    </div>
  );
}
