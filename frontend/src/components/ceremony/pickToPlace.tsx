import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DRAG_TASK } from './types';

/**
 * TAP TO ASSIGN — the ceremony stage's drag-and-drop, for devices that cannot drag.
 *
 * Every interaction on the stage (assign to a seat, group into an epic, schedule
 * into the sprint, return to the backlog, mark done) rode native HTML5 drag-and-drop.
 * `dragstart` does not fire on touch, so the mobile-responsive pass made the stage
 * READABLE on a phone and left it entirely READ-ONLY.
 *
 * Rather than adopt a pointer-based DnD library — which would replace a working
 * desktop interaction to fix a missing mobile one — the same intent is offered in two
 * steps: PICK a task, then PLACE it on any target. The pick is explicit (a button on
 * the card), so it needs no long-press timing, and works with a mouse, a finger, a
 * keyboard (Enter/Space to pick up and to drop, Esc to cancel) and a screen reader.
 *
 * ── ONE DROP PATH ───────────────────────────────────────────────────────────
 * Every target is a {@link CeremonyDropZone}: the drag handlers AND the tap/keyboard
 * handlers come from the same component and call the same `onPlace` — the stage's own
 * assign / group / schedule / return handler. Before, each of the five targets wired
 * `onDragOver`/`onDrop`/`dataTransfer` by hand and spread the pick props beside them,
 * and the pick props' highlight was silently lost on every one because the target's own
 * `style` was spread after it.
 *
 * The picked task lives in context rather than in `CeremonyStage`'s state because the
 * targets are spread across sibling components (seat, backlog rail, epic rail, and the
 * stage's own sprint/standup zones) — prop-drilling it would put the same props on each.
 */

interface CeremonyPickValue {
  /** The task waiting to be placed, or null. */
  pickedTaskId: number | null;
  /** Its title, for the banner and the targets' accessible labels. */
  pickedTitle: string | null;
  pick: (taskId: number, title: string) => void;
  clear: () => void;
}

const CeremonyPickContext = createContext<CeremonyPickValue | null>(null);

/** The task id a native drag carries, or null when the drag is not one of ours. */
export function draggedTaskId(transfer: Pick<DataTransfer, 'getData'> | null | undefined): number | null {
  const id = Number(transfer?.getData(DRAG_TASK));
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Whether a click on a zone came from a control INSIDE it (the sprint picker, a seat's
 * scorecard button) rather than the zone itself. Those keep their own meaning while a
 * task is picked — choosing a sprint must not drop the task into the old one.
 */
export function isFromNestedControl(target: EventTarget | null, zone: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const control = target.closest('button, select, input, textarea, a[href], [role="button"]');
  return control != null && control !== zone;
}

/** What a key means on a drop target while a task is picked. */
export function placeKeyIntent(key: string): 'place' | 'cancel' | null {
  if (key === 'Enter' || key === ' ') return 'place';
  if (key === 'Escape') return 'cancel';
  return null;
}

export function CeremonyPickProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations('ceremony');
  const [picked, setPicked] = useState<{ id: number; title: string } | null>(null);
  const pick = useCallback((taskId: number, title: string) => {
    // Picking the picked task again puts it down — the gesture is its own undo.
    setPicked((current) => (current?.id === taskId ? null : { id: taskId, title }));
  }, []);
  const clear = useCallback(() => setPicked(null), []);
  const value = useMemo<CeremonyPickValue>(
    () => ({ pickedTaskId: picked?.id ?? null, pickedTitle: picked?.title ?? null, pick, clear }),
    [picked, pick, clear],
  );

  // Esc cancels from anywhere, not only from a focused target — the person who picked
  // a task up with the keyboard is still focused on the card's own button.
  useEffect(() => {
    if (!picked) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPicked(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [picked]);

  return (
    <CeremonyPickContext.Provider value={value}>
      {picked && (
        // Sticky so it stays in view while a phone scrolls to the destination; a live
        // region so a screen reader hears what is in hand and how to put it down.
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 2,
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            marginBottom: 8,
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--coral-bright)',
            background: 'var(--surface-coral-soft)',
            color: 'var(--text-primary)',
            fontSize: 'var(--font-size-small)',
          }}
        >
          <span style={{ flex: '1 1 200px', minWidth: 0, overflowWrap: 'anywhere' }}>
            {t('pickBanner', { title: picked.title })}
          </span>
          <button
            type="button"
            onClick={clear}
            style={{
              minHeight: 32,
              padding: '4px 12px',
              fontSize: 'var(--font-size-small)',
              fontWeight: 600,
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--coral-bright)',
              background: 'var(--bg-elevated)',
              color: 'var(--coral-bright)',
              cursor: 'pointer',
            }}
          >
            {t('cancelPick')}
          </button>
        </div>
      )}
      {children}
    </CeremonyPickContext.Provider>
  );
}

/**
 * Non-throwing: the task card and the rails are also rendered outside the stage
 * (the assigned-work panel, the history drawer), and a card with no provider
 * above it should simply not offer the pick affordance.
 */
export function useCeremonyPick(): CeremonyPickValue | null {
  return useContext(CeremonyPickContext);
}

/** What a drop zone's styling can react to. */
export interface DropZoneState {
  /** A native drag is hovering over it. */
  over: boolean;
  /** A task is picked and this zone is a valid place to put it. */
  targeted: boolean;
}

/**
 * ONE drop target, for every way of dropping: a native drag, a tap, or a key.
 *
 * `onPlace` is the stage's own handler, called identically from all three. When
 * `enabled` is false (no active sprint, the wrong mode) the zone is an ordinary
 * container. While nothing is picked it gains no role, focus stop or click handler,
 * so `onClick` (an epic opening its drawer) keeps working.
 */
export function CeremonyDropZone({
  label,
  onPlace,
  enabled = true,
  onClick,
  title,
  style,
  children,
}: {
  /** Accessible name while a task is picked: "Assign to Ana", "Return to backlog". */
  label: string;
  onPlace: (taskId: number) => void;
  enabled?: boolean;
  onClick?: () => void;
  title?: string;
  style: React.CSSProperties | ((state: DropZoneState) => React.CSSProperties);
  children: React.ReactNode;
}) {
  const pick = useCeremonyPick();
  const [over, setOver] = useState(false);
  const pickedTaskId = enabled ? pick?.pickedTaskId ?? null : null;
  const targeted = pickedTaskId != null;
  const base = typeof style === 'function' ? style({ over, targeted }) : style;

  const place = () => {
    if (pickedTaskId == null) return;
    onPlace(pickedTaskId);
    pick?.clear();
  };

  return (
    <div
      title={title}
      onDragOver={enabled ? (event) => { event.preventDefault(); setOver(true); } : undefined}
      onDragLeave={enabled ? () => setOver(false) : undefined}
      onDrop={enabled ? (event) => {
        event.preventDefault();
        setOver(false);
        const id = draggedTaskId(event.dataTransfer);
        if (id != null) onPlace(id);
      } : undefined}
      // A pick in flight turns the zone into a DESTINATION: its own click (an epic
      // opening) yields to placing, and it becomes a keyboard stop.
      onClick={targeted
        ? (event) => { if (!isFromNestedControl(event.target, event.currentTarget)) place(); }
        : onClick}
      {...(targeted ? {
        role: 'button',
        tabIndex: 0,
        'aria-label': label,
        onKeyDown: (event: React.KeyboardEvent) => {
          // Keys typed into a nested control (the sprint picker) are that control's.
          if (event.target !== event.currentTarget) return;
          const intent = placeKeyIntent(event.key);
          if (!intent) return;
          event.preventDefault();
          if (intent === 'place') place();
          else pick?.clear();
        },
      } : {})}
      style={{
        ...base,
        // A dashed outline in the accent hue, so every valid destination announces
        // itself the moment something is picked up. Merged AFTER the zone's own style.
        ...(targeted ? { outline: '2px dashed var(--coral-bright)', outlineOffset: 2, cursor: 'pointer' } : {}),
      }}
    >
      {children}
    </div>
  );
}
