'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  type CanvasModel,
  type CanvasBlock,
  type CanvasBlockType,
  defaultBlock,
  elapsedMs,
  remainingMs,
  STICKY_COLORS,
} from './canvasModel';

/**
 * Reusable, self-contained canvas board. Free-form, absolutely-positioned blocks
 * you can drag, resize, edit and delete — text, sticky notes, images, embedded
 * knowledge docs, and collaborative timer/stopwatch widgets.
 *
 * Fully controlled: it renders `value` and calls `onChange` with the next model
 * on every committed mutation (drag end, edit, widget control). The parent owns
 * persistence + realtime sync, so the SAME component backs the Knowledge editor's
 * canvas mode AND the Brain/Brainstorm slide-out without modification.
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

const ADD_TYPES: CanvasBlockType[] = ['text', 'sticky', 'image', 'embed', 'timer', 'stopwatch'];

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
          <span style={{ fontSize: 12, color: 'var(--text-muted, #9ca3af)', marginLeft: 'auto' }}>
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
          borderRadius: 12,
          border: '1px solid var(--border, #333)',
          background:
            'var(--surface-2, #131313) radial-gradient(var(--border, #2a2a2a) 1px, transparent 1px) 0 0 / 22px 22px',
        }}
      >
        {model.blocks.length === 0 && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--text-muted, #9ca3af)', fontSize: 14 }}>
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
    borderRadius: 10,
    border: selected ? '2px solid var(--accent, #2563eb)' : '1px solid var(--border, #333)',
    background: block.type === 'sticky' ? (block as { color: string }).color : 'var(--surface, #1d1d1d)',
    color: block.type === 'sticky' ? '#1a1a1a' : 'inherit',
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
          <button type="button" onClick={onRemove} title={t('remove')} style={{ ...iconBtn, color: block.type === 'sticky' ? '#1a1a1a' : 'inherit' }}>
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
                  style={{ width: 14, height: 14, borderRadius: '50%', background: c, border: block.color === c ? '2px solid #1a1a1a' : '1px solid rgba(0,0,0,0.3)', cursor: 'pointer' }}
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
        <div style={{ color: 'var(--text-muted, #9ca3af)', fontSize: 12, margin: 'auto' }}>{t('noImage')}</div>
      ) : (
        <input value={block.url} placeholder={t('imageUrlPlaceholder')} onChange={(e) => onUpdate({ url: e.target.value })} style={inlineInput} />
      );

    case 'embed':
      return block.documentId ? (
        <Link href={`/knowledge/${block.documentId}`} style={{ color: 'var(--accent, #60a5fa)', fontSize: 13, margin: 'auto', textAlign: 'center' }}>
          📄 {block.title || t('openEmbeddedDoc')}
        </Link>
      ) : readOnly ? (
        <div style={{ color: 'var(--text-muted, #9ca3af)', fontSize: 12, margin: 'auto' }}>{t('noEmbed')}</div>
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
      <div style={{ fontSize: 30, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: danger ? 'var(--error-text, #f87171)' : undefined }}>
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
  borderRadius: 8,
  border: '1px solid var(--border, #333)',
  background: 'var(--surface, #1a1a1a)',
  color: 'inherit',
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
};
const miniBtn: React.CSSProperties = {
  padding: '3px 8px',
  borderRadius: 6,
  border: '1px solid var(--border, #444)',
  background: 'var(--surface-2, #222)',
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
const inlineInput: React.CSSProperties = {
  width: '100%',
  margin: 'auto 0',
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid var(--border, #333)',
  background: 'var(--surface-2, #111)',
  color: 'inherit',
  fontSize: 12,
};
