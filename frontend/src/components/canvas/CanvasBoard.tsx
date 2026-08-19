'use client';

import { Icon } from '@/components/ui/Icon';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  type CanvasModel,
  type CanvasBlock,
  type CanvasBlockType,
  type WebPageBlock,
  defaultBlock,
  elapsedMs,
  remainingMs,
  STICKY_COLORS,
} from './canvasModel';
import { CanvasWebPage } from '@/components/creation-canvas/CanvasWebPage';
import { CanvasDeviceFrame } from '@/components/creation-canvas/CanvasDeviceFrame';
import type { CreationNodeData } from '@/components/creation-canvas/types';

/**
 * Reusable, self-contained canvas board. Free-form, absolutely-positioned blocks
 * you can drag, resize, edit and delete — text, sticky notes, images, live web
 * pages, embedded knowledge docs, and collaborative timer/stopwatch widgets.
 *
 * Fully controlled: it renders `value` and calls `onChange` with the next model
 * on every committed mutation (drag end, edit, widget control). The parent owns
 * persistence + realtime sync, so the SAME component backs the Knowledge editor's
 * canvas mode AND the Brain/Brainstorm slide-out without modification.
 *
 * ── NO IFRAME IS WRITTEN HERE ────────────────────────────────────────────────
 * Both blocks that hold a remote document — `webpage` and an embeddable `video`
 * URL — render through the creation canvas's own framing components rather than
 * an `<iframe src>` written in this file. That is not tidiness: an iframe on a
 * board is a security decision (which sandbox tokens, which `allow` features,
 * which referrer policy), and this board had been making that decision a second
 * time, differently, with no probe and no fallback for a page that refuses to be
 * framed. `CanvasWebPage` owns the whole answer; `CanvasDeviceFrame` owns the
 * element. This board only says WHICH of the two a block is.
 */
export interface CanvasBoardProps {
  value: CanvasModel;
  onChange?: (next: CanvasModel) => void;
  readOnly?: boolean;
  /** Board height (px or CSS length). Defaults to a tall scrollable area. */
  height?: number | string;
}

const TICK_MS = 250;

function fmt(ms: number): string {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const ADD_TYPES: CanvasBlockType[] = ['text', 'sticky', 'image', 'video', 'webpage', 'file', 'embed', 'timer', 'stopwatch'];

/** Treat a URL as a direct video file (use <video>) vs an embeddable page (<iframe>). */
function isDirectVideo(url: string): boolean {
  return /\.(mp4|webm|ogg|mov)(\?|#|$)/i.test(url);
}

export function CanvasBoard({ value, onChange, readOnly = false, height = 600 }: CanvasBoardProps) {
  const t = useTranslations('canvas');
  const boardRef = useRef<HTMLDivElement>(null);
  const [model, setModel] = useState<CanvasModel>(value);
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const drag = useRef<{ id: string; mode: 'move' | 'resize'; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number } | null>(null);

  // Re-sync from the parent when not mid-drag (e.g. realtime collab update).
  useEffect(() => {
    if (!drag.current) setModel(value);
  }, [value]);

  // Tick only while a timer/stopwatch is running, so idle boards don't re-render.
  const anyRunning = model.blocks.some((b) => (b.type === 'timer' || b.type === 'stopwatch') && b.startedAt != null);
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [anyRunning]);

  const commit = useCallback(
    (next: CanvasModel) => {
      setModel(next);
      onChange?.(next);
    },
    [onChange],
  );

  const update = useCallback(
    (id: string, patch: Partial<CanvasBlock>) => {
      commit({ ...model, blocks: model.blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as CanvasBlock) : b)) });
    },
    [model, commit],
  );

  const addBlock = useCallback(
    (type: CanvasBlockType) => {
      const offset = model.blocks.length % 6;
      const block = defaultBlock(type, { x: 40 + offset * 24, y: 40 + offset * 24 });
      commit({ ...model, blocks: [...model.blocks, block] });
      setSelected(block.id);
    },
    [model, commit],
  );

  const removeBlock = useCallback(
    (id: string) => {
      commit({ ...model, blocks: model.blocks.filter((b) => b.id !== id) });
      setSelected((s) => (s === id ? null : s));
    },
    [model, commit],
  );

  // --- drag / resize via pointer events -----------------------------------
  function onPointerDownBlock(e: React.PointerEvent, block: CanvasBlock, mode: 'move' | 'resize') {
    if (readOnly) return;
    e.stopPropagation();
    setSelected(block.id);
    drag.current = { id: block.id, mode, sx: e.clientX, sy: e.clientY, ox: block.x, oy: block.y, ow: block.w, oh: block.h };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    setModel((m) => ({
      ...m,
      blocks: m.blocks.map((b) => {
        if (b.id !== d.id) return b;
        if (d.mode === 'move') return { ...b, x: Math.max(0, d.ox + dx), y: Math.max(0, d.oy + dy) };
        return { ...b, w: Math.max(120, d.ow + dx), h: Math.max(80, d.oh + dy) };
      }),
    }));
  }
  function onPointerUp() {
    if (drag.current) {
      drag.current = null;
      onChange?.(model); // commit the moved/resized geometry
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {!readOnly && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {ADD_TYPES.map((type) => (
            <button key={type} type="button" onClick={() => addBlock(type)} style={toolBtn} title={t(`add_${type}`)}>
              {t(`add_${type}`)}
            </button>
          ))}
          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>
            {t('blockCount', { count: model.blocks.length })}
          </span>
        </div>
      )}

      <div
        ref={boardRef}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onPointerDown={() => setSelected(null)}
        style={{
          position: 'relative',
          height,
          overflow: 'auto',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)',
          background:
            'var(--surface-2) radial-gradient(var(--border) 1px, transparent 1px) 0 0 / 22px 22px',
        }}
      >
        {model.blocks.length === 0 && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
            {readOnly ? t('emptyReadOnly') : t('emptyHint')}
          </div>
        )}
        {model.blocks.map((b) => (
          <BlockView
            key={b.id}
            block={b}
            now={now}
            selected={selected === b.id}
            readOnly={readOnly}
            t={t}
            onPointerDownMove={(e) => onPointerDownBlock(e, b, 'move')}
            onPointerDownResize={(e) => onPointerDownBlock(e, b, 'resize')}
            onUpdate={(patch) => update(b.id, patch)}
            onRemove={() => removeBlock(b.id)}
          />
        ))}
      </div>
    </div>
  );
}

function BlockView({
  block,
  now,
  selected,
  readOnly,
  t,
  onPointerDownMove,
  onPointerDownResize,
  onUpdate,
  onRemove,
}: {
  block: CanvasBlock;
  now: number;
  selected: boolean;
  readOnly: boolean;
  t: ReturnType<typeof useTranslations>;
  onPointerDownMove: (e: React.PointerEvent) => void;
  onPointerDownResize: (e: React.PointerEvent) => void;
  onUpdate: (patch: Partial<CanvasBlock>) => void;
  onRemove: () => void;
}) {
  const frame: React.CSSProperties = {
    position: 'absolute',
    left: block.x,
    top: block.y,
    width: block.w,
    height: block.h,
    borderRadius: 'var(--radius-lg)',
    border: selected ? '2px solid var(--accent)' : '1px solid var(--border)',
    background: block.type === 'sticky' ? (block as { color: string }).color : 'var(--surface)',
    color: block.type === 'sticky' ? 'var(--ink-on-light)' : 'inherit',
    boxShadow: selected ? '0 6px 24px rgba(0,0,0,0.35)' : '0 1px 4px rgba(0,0,0,0.2)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  };

  return (
    <div style={frame} onPointerDown={(e) => e.stopPropagation()}>
      <div
        onPointerDown={onPointerDownMove}
        style={{
          height: 22,
          flexShrink: 0,
          cursor: readOnly ? 'default' : 'move',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 6px',
          background: 'rgba(0,0,0,0.18)',
          fontSize: 11,
          fontWeight: 600,
        }}
      >
        <span style={{ opacity: 0.8 }}>{t(`type_${block.type}`)}</span>
        {!readOnly && (
          <button type="button" onClick={onRemove} title={t('remove')} style={{ ...iconBtn, color: block.type === 'sticky' ? 'var(--ink-on-light)' : 'inherit' }}>
            ×
          </button>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, padding: 8, display: 'flex', flexDirection: 'column' }}>
        <BlockBody block={block} now={now} readOnly={readOnly} t={t} onUpdate={onUpdate} />
      </div>
      {!readOnly && (
        <div
          onPointerDown={onPointerDownResize}
          style={{ position: 'absolute', right: 0, bottom: 0, width: 16, height: 16, cursor: 'nwse-resize', opacity: 0.5 }}
          title={t('resize')}
        >
          <svg viewBox="0 0 16 16" width="16" height="16">
            <path d="M16 16 L16 6 M16 16 L6 16" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
        </div>
      )}
    </div>
  );
}

function BlockBody({
  block,
  now,
  readOnly,
  t,
  onUpdate,
}: {
  block: CanvasBlock;
  now: number;
  readOnly: boolean;
  t: ReturnType<typeof useTranslations>;
  onUpdate: (patch: Partial<CanvasBlock>) => void;
}) {
  const textArea: React.CSSProperties = {
    flex: 1,
    width: '100%',
    resize: 'none',
    border: 'none',
    outline: 'none',
    background: 'transparent',
    color: 'inherit',
    fontSize: 13,
    fontFamily: 'inherit',
  };

  switch (block.type) {
    case 'text':
      return readOnly ? (
        <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, overflow: 'auto' }}>{block.text || ''}</div>
      ) : (
        <textarea value={block.text} placeholder={t('textPlaceholder')} onChange={(e) => onUpdate({ text: e.target.value })} style={textArea} />
      );

    case 'sticky':
      return (
        <>
          {readOnly ? (
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, flex: 1, overflow: 'auto' }}>{block.text}</div>
          ) : (
            <textarea value={block.text} placeholder={t('stickyPlaceholder')} onChange={(e) => onUpdate({ text: e.target.value })} style={textArea} />
          )}
          {!readOnly && (
            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
              {STICKY_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onUpdate({ color: c })}
                  title={t('color')}
                  style={{ width: 14, height: 14, borderRadius: '50%', background: c, border: block.color === c ? '2px solid var(--ink-on-light)' : '1px solid rgba(0,0,0,0.3)', cursor: 'pointer' }}
                />
              ))}
            </div>
          )}
        </>
      );

    case 'image':
      return block.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={block.url} alt={block.alt || ''} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', margin: 'auto' }} />
      ) : readOnly ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 12, margin: 'auto' }}>{t('noImage')}</div>
      ) : (
        <input value={block.url} placeholder={t('imageUrlPlaceholder')} onChange={(e) => onUpdate({ url: e.target.value })} style={inlineInput} />
      );

    case 'video':
      return block.url ? (
        isDirectVideo(block.url) ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video src={block.url} controls style={{ maxWidth: '100%', maxHeight: '100%', margin: 'auto' }} />
        ) : (
          // An embeddable player, through the canvas's ONE frame element. `fill`
          // rather than a device width because a player has no media queries to
          // exercise — the device reading would only shrink the picture.
          <CanvasDeviceFrame
            title={t('type_video')}
            viewport="desktop"
            fill
            src={block.url}
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            referrerPolicy="no-referrer"
            loading="lazy"
            frameClassName="nodrag nowheel"
          />
        )
      ) : readOnly ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 12, margin: 'auto' }}>{t('noVideo')}</div>
      ) : (
        <input value={block.url} placeholder={t('videoUrlPlaceholder')} onChange={(e) => onUpdate({ url: e.target.value.trim() })} style={inlineInput} />
      );

    case 'webpage':
      return <WebPageBody block={block} readOnly={readOnly} onUpdate={onUpdate} />;

    case 'file':
      return block.url ? (
        <a href={block.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent, var(--info))', fontSize: 13, margin: 'auto', textAlign: 'center', wordBreak: 'break-all' }}>
          
          <Icon source="📎" size="1em" /> {block.name || block.url}
        </a>
      ) : readOnly ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 12, margin: 'auto' }}>{t('noFile')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: 'auto 0' }}>
          <input value={block.name ?? ''} placeholder={t('fileNamePlaceholder')} onChange={(e) => onUpdate({ name: e.target.value })} style={inlineInput} />
          <input value={block.url} placeholder={t('fileUrlPlaceholder')} onChange={(e) => onUpdate({ url: e.target.value.trim() })} style={inlineInput} />
        </div>
      );

    case 'embed':
      return block.documentId ? (
        <Link href={`/knowledge/${block.documentId}`} style={{ color: 'var(--accent, var(--info))', fontSize: 13, margin: 'auto', textAlign: 'center' }}>
          
          <Icon source="📄" size="1em" /> {block.title || t('openEmbeddedDoc')}
        </Link>
      ) : readOnly ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 12, margin: 'auto' }}>{t('noEmbed')}</div>
      ) : (
        <input value={block.documentId} placeholder={t('embedIdPlaceholder')} onChange={(e) => onUpdate({ documentId: e.target.value.trim() })} style={inlineInput} />
      );

    case 'timer': {
      const remaining = remainingMs(block, now);
      const done = remaining <= 0 && block.baseElapsedMs + (block.startedAt != null ? now - block.startedAt : 0) > 0;
      return (
        <WidgetBody
          display={fmt(remaining)}
          danger={done}
          running={block.startedAt != null}
          readOnly={readOnly}
          t={t}
          onStartPause={() =>
            block.startedAt != null
              ? onUpdate({ startedAt: null, baseElapsedMs: elapsedMs(block, now) })
              : onUpdate({ startedAt: now })
          }
          onReset={() => onUpdate({ startedAt: null, baseElapsedMs: 0 })}
          extra={
            !readOnly && block.startedAt == null ? (
              <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                {[1, 5, 10, 25].map((min) => (
                  <button key={min} type="button" onClick={() => onUpdate({ durationMs: min * 60000, baseElapsedMs: 0 })} style={miniBtn}>
                    {min}m
                  </button>
                ))}
              </div>
            ) : null
          }
        />
      );
    }

    case 'stopwatch':
      return (
        <WidgetBody
          display={fmt(elapsedMs(block, now))}
          running={block.startedAt != null}
          readOnly={readOnly}
          t={t}
          onStartPause={() =>
            block.startedAt != null
              ? onUpdate({ startedAt: null, baseElapsedMs: elapsedMs(block, now) })
              : onUpdate({ startedAt: now })
          }
          onReset={() => onUpdate({ startedAt: null, baseElapsedMs: 0 })}
        />
      );
  }
}

function WidgetBody({
  display,
  running,
  readOnly,
  danger,
  t,
  onStartPause,
  onReset,
  extra,
}: {
  display: string;
  running: boolean;
  readOnly: boolean;
  danger?: boolean;
  t: ReturnType<typeof useTranslations>;
  onStartPause: () => void;
  onReset: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center', alignItems: 'center', flex: 1 }}>
      <div style={{ fontSize: 30, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: danger ? 'var(--error-text, var(--error))' : undefined }}>
        {display}
      </div>
      {!readOnly && (
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button" onClick={onStartPause} style={miniBtn}>
            {running ? t('pause') : t('start')}
          </button>
          <button type="button" onClick={onReset} style={miniBtn}>
            {t('reset')}
          </button>
        </div>
      )}
      {extra}
    </div>
  );
}

const toolBtn: React.CSSProperties = {
  padding: '5px 10px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
};
const miniBtn: React.CSSProperties = {
  padding: '3px 8px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 12,
};
const iconBtn: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  fontSize: 16,
  lineHeight: 1,
  padding: 0,
};
/**
 * The live page block, rendered by the SAME panel the Creation Canvas uses.
 *
 * The panel is written against a creation-canvas object (`CreationNodeData`),
 * because that is the model it writes its probe results back into. A block is a
 * flatter shape with the same field NAMES, so the adapter is a projection in and
 * a filtered patch out — not a second implementation of framing, probing, the
 * reader fallback for a page that refuses to be framed, or the console strip.
 *
 * `kind: 'browser'` is what makes the panel treat the object as a live page; it
 * is the vocabulary `canvasWebPage.ts` already owns, not a value invented here.
 */
function WebPageBody({ block, readOnly, onUpdate }: {
  block: WebPageBlock;
  readOnly: boolean;
  onUpdate: (patch: Partial<CanvasBlock>) => void;
}) {
  const data = useMemo<CreationNodeData>(() => ({
    kind: 'browser',
    title: block.pageTitle || block.url || '',
    url: block.url,
    viewport: block.viewport,
    content: block.content,
    frameCheckedUrl: block.frameCheckedUrl,
    frameable: block.frameable,
    frameBlockedBy: block.frameBlockedBy,
    pageTitle: block.pageTitle,
    httpStatus: block.httpStatus,
    fetchedAt: block.fetchedAt,
  }), [block]);

  // Only the fields the block actually stores are written back. The panel also
  // emits its console report, which belongs to a preview of something the canvas
  // BUILT — a pinned reference page has no build to report on.
  const apply = useCallback((patch: Partial<CreationNodeData>) => {
    const next: Partial<WebPageBlock> = {};
    if (typeof patch.url === 'string') next.url = patch.url;
    if (typeof patch.viewport === 'string') next.viewport = patch.viewport;
    if (typeof patch.content === 'string') next.content = patch.content;
    if (typeof patch.frameCheckedUrl === 'string') next.frameCheckedUrl = patch.frameCheckedUrl;
    if (typeof patch.frameable === 'boolean') next.frameable = patch.frameable;
    if (patch.frameBlockedBy === null || typeof patch.frameBlockedBy === 'string') next.frameBlockedBy = patch.frameBlockedBy;
    if (patch.pageTitle === null || typeof patch.pageTitle === 'string') next.pageTitle = patch.pageTitle;
    if (typeof patch.httpStatus === 'number') next.httpStatus = patch.httpStatus;
    if (typeof patch.fetchedAt === 'string') next.fetchedAt = patch.fetchedAt;
    if (Object.keys(next).length > 0) onUpdate(next as Partial<CanvasBlock>);
  }, [onUpdate]);

  return <CanvasWebPage data={data} {...(readOnly ? {} : { onEdit: apply })} />;
}

const inlineInput: React.CSSProperties = {
  width: '100%',
  margin: 'auto 0',
  padding: '6px 8px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  background: 'var(--surface-2)',
  color: 'inherit',
  fontSize: 12,
};
