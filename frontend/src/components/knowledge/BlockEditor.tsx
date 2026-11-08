import { useCallback, useRef, useState, type CSSProperties } from 'react';
import type { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import type { DocumentBlock } from '@/domains/collab/domain/blockDocument';
import { DRAWING_BLOCK_HEIGHT, DRAWING_BLOCK_WIDTH, textBlockKind } from '@/domains/collab/domain/blockDocument';
import type { BlockDocument, BlockPeer } from '@/domains/collab/presentation/useBlockDocument';
import { uploadAsset, assetUrl } from '@/lib/assetsApi';
import { BLOCK_RENDERERS, type BlockRendererProps } from './blocks/blockRenderers';
import { gutterButtonStyle } from './blocks/blockStyles';

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
            fontSize: 'var(--font-size-field-label)',
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
  const fontSize = kind === 'heading' ? 'var(--font-size-card-title)' : 'var(--font-size-body)';
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

/** Dispatches a non-text block to its renderer through the registry. */
function BlockRenderer(props: BlockRendererProps) {
  const Renderer = BLOCK_RENDERERS[props.block.type as Exclude<DocumentBlock['type'], 'text'>];
  return <Renderer {...props} />;
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
                <BlockRenderer
                  block={block}
                  t={t}
                  readOnly={readOnly}
                  onFocus={() => doc.setFocusedBlock(block.id)}
                  strokeOps={{
                    append: (strokes) => doc.appendStrokes(block.id, strokes),
                    remove: (strokeIds) => doc.removeStrokes(block.id, strokeIds),
                    update: (strokeId, patch) => doc.updateStroke(block.id, strokeId, patch),
                    clear: () => doc.clearStrokes(block.id),
                  }}
                  onReplace={(file) => void upload(file, null, block.id)}
                />
              )}
              {uploadingId === block.id && (
                <div style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)' }}>{t('blockUploading')}</div>
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
          onAddDrawing={() => doc.setFocusedBlock(doc.insertAfter(doc.blocks[doc.blocks.length - 1]?.id ?? null, { id: `d-${Date.now()}`, type: 'drawing', text: '', attrs: { strokes: [], width: DRAWING_BLOCK_WIDTH, height: DRAWING_BLOCK_HEIGHT } }))}
        />
      )}
    </div>
  );
}

function BlockToolbar({
  t,
  onAddText,
  onAddMedia,
  onAddDrawing,
}: {
  t: ReturnType<typeof useTranslations>;
  onAddText: () => void;
  onAddMedia: (file: File) => void;
  onAddDrawing: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
      <button type="button" onClick={onAddText} style={{ ...gutterButtonStyle, width: 'auto', padding: '4px 10px' }}>
        + {t('blockAddText')}
      </button>
      <button type="button" onClick={() => inputRef.current?.click()} style={{ ...gutterButtonStyle, width: 'auto', padding: '4px 10px' }}>
        + {t('blockAddMedia')}
      </button>
      <button type="button" onClick={onAddDrawing} style={{ ...gutterButtonStyle, width: 'auto', padding: '4px 10px' }}>
        + {t('blocks.drawing.add')}
      </button>
      <input
        ref={inputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={(e) => { const file = e.target.files?.[0]; if (file) onAddMedia(file); e.target.value = ''; }}
      />
      <span style={{ fontSize: 'var(--font-size-eyebrow)', color: 'var(--text-muted)', alignSelf: 'center' }}>{t('blockDropHint')}</span>
    </div>
  );
}
