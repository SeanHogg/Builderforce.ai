/*
 * No `'use client'` — mounted only inside surfaces reached through a
 * `dynamic(..., { ssr: false })` import, since WebGL has no server-side render.
 */
import { Html } from '@react-three/drei';

/** The caption's Open button. Absent, the caption is a label only. */
export interface RoomItemOpen {
  /** The visible word. Translated by the host. */
  label: string;
  /** The accessible name, when the visible word alone is ambiguous among several. */
  name?: string | undefined;
  testId: string;
  onOpen: () => void;
}

export interface RoomItemCaptionProps {
  /** World-space point the caption centres on — above the thing, not inside it. */
  position: [number, number, number];
  title: string;
  hint: string;
  testId: string;
  open?: RoomItemOpen | undefined;
}

/**
 * The label over a thing in the room, and the button that opens it.
 *
 * DOM over the canvas rather than text in the scene: it stays legible at any
 * distance and in either theme, and it is a real button a keyboard and a screen
 * reader can reach. Shared by the session's diorama and every creation, so "what is
 * this, and how do I open it" reads the same wherever it is asked.
 */
export function RoomItemCaption({ position, title, hint, testId, open }: RoomItemCaptionProps) {
  return (
    <Html position={position} center distanceFactor={9} zIndexRange={[10, 0]}>
      <span
        data-testid={testId}
        // A pointer that lands on the caption must not start a drag of the body
        // under it — and R3F never sees it, because the caption is DOM.
        onPointerDown={(event) => event.stopPropagation()}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          maxWidth: 260,
          padding: open ? '3px 3px 3px 9px' : '4px 9px',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--font-size-small)',
          lineHeight: 1.4,
          background: 'var(--surface, #1a1a1a)',
          color: 'var(--text-primary, #f5f5f5)',
          border: '1px solid var(--border, #333)',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ display: 'block', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <strong style={{ fontWeight: 600 }}>{title}</strong>
          <span style={{ display: 'block', color: 'var(--text-secondary, #a0a0a0)', fontSize: 'var(--font-size-eyebrow)' }}>{hint}</span>
        </span>
        {open && (
          <button
            type="button"
            data-testid={open.testId}
            onClick={open.onOpen}
            aria-label={open.name}
            style={{
              flex: '0 0 auto',
              minHeight: 28,
              padding: '0 10px',
              border: '1px solid var(--accent, #6d5dfc)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--surface, #1a1a1a)',
              color: 'var(--text-primary, #f5f5f5)',
              fontSize: 'var(--font-size-small)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {open.label}
          </button>
        )}
      </span>
    </Html>
  );
}
