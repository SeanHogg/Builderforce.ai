import { memo } from 'react';
import { useTranslations } from 'next-intl';
import { DisclosureIcon, ProveIdeaIcon } from '@/components/canvas/CanvasCommands';
import { CanvasAppPanel } from '@/components/apps/CanvasAppPanel';
import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';
import type { CanvasSessionActionId } from '@/lib/canvasSessionActions';
import { CanvasMenuSheet } from '../CanvasMenuSheet';
import { CanvasSessionActions, type CanvasSessionActionHandler } from '../CanvasSessionActions';
import { useCanvasSessionFacts } from './canvasSessionContext';
import styles from '../CreationCanvas.module.css';

export interface CanvasMakeItRealProps {
  open: boolean;
  /** Opens or closes this menu, closing the board menu and the invite sheet. */
  onToggle: () => void;
  onClose: () => void;
  surface: CanvasSurfaceId;
  collapsed: boolean;
  handlers: Record<CanvasSessionActionId, CanvasSessionActionHandler>;
  /** Download the whole session — the door that needs no server at all. */
  onExport: () => void;
}

/**
 * PUBLISH, and the overflow that holds everything a phone cannot fit.
 *
 * Invite used to live here too, worded and beside Publish. It now draws as the
 * trailing chip on the roster itself (`chrome: 'roster'` in
 * `canvasSessionActions.ts`, rendered by `CanvasCommandBar`'s own
 * `CanvasSessionActions variant="roster"`) — a glyph the same size as the avatars it
 * follows, because "who is here" and "bring someone else in" read as one group, not
 * two: the word was the only thing telling them apart, and it was telling a lie
 * about how separate they were.
 *
 * ── WHY THIS LIVES IN THE BAR NOW, NOT THE HEADER ────────────────────────────────
 * It used to portal into the application header's own top-right corner — a DOM slot
 * (`lib/canvas/CanvasChromeSlot.tsx`, since removed) that let the row escape into
 * whichever header the shell had mounted, `MarketingHeader` signed out or `TopBar`
 * signed in. That solved one collision (two bars of controls fourteen pixels apart) by
 * creating a smaller one: the header's OWN cluster — cart, theme, sign-in-or-out — sat
 * beside a row that belonged to the canvas, not the shell, so a visitor read one corner
 * as two systems that happened to share it. It also meant Publish/••• read differently
 * signed in versus signed out, because the two headers are structurally different
 * chromes, not a swapped button or two.
 *
 * The bar already answers "what can I do to this canvas" for every other action; this
 * is answered the same way now, kept a visual step apart — a divider, not a border of
 * its own — from the glyphs beside it.
 */
/**
 * MAKE IT REAL — the ONE worded control on the bar, and every door out beneath it.
 *
 * The bar used to carry two worded buttons side by side: *Make it real* opened the
 * proof picker and *Publish* opened the release lifecycle. Two words at the same weight
 * that both mean "ship it" read as a fork, and nothing on the bar said which fork was
 * which — so the doors are rows under one trigger now. `chrome: 'door'` in
 * `canvasSessionActions.ts` is what files an action here, so a door added later lands
 * in this menu without this file being edited.
 *
 * The two rows that are NOT registry actions are here for the same reason the registry
 * ones are: *Make this a project* is a door out (a board becomes one project, ever) and
 * self-gates to nothing on a local board or for a viewer; *Export* is the door that
 * needs no server at all. Both used to be filed in the ••• sheet under headings
 * ("Create and view", "Session tools") that grouped them with things they have nothing
 * to do with.
 *
 * It closes the REACH group on the bar, because putting the result in front of people
 * is what Reach means and a door out is the last thing you do in it.
 */
export const CanvasMakeItReal = memo(function CanvasMakeItReal({ open, onToggle, onClose, surface, collapsed, handlers, onExport }: CanvasMakeItRealProps) {
  const t = useTranslations('creationCanvas');
  const { sessionId, persistence } = useCanvasSessionFacts();
  return (
      <div className={styles.handoffGroup} data-testid="canvas-handoff">
          <button
            type="button"
            className={styles.sessionActionLabelled}
            data-testid="canvas-make-it-real"
            aria-expanded={open}
            aria-haspopup="menu"
            title={t('proveThisIdeaTitle')}
            onClick={onToggle}
          ><ProveIdeaIcon /><span>{t('proveThisIdea')}</span><i aria-hidden><DisclosureIcon /></i></button>
          {open && <CanvasMenuSheet title={t('proveThisIdea')} testId="canvas-make-it-real-menu" role="menu" onClose={onClose}>
            <CanvasSessionActions variant="doors" surface={surface} collapsed={collapsed} handlers={handlers} />
            {/* Turn the board into a project. Self-gating: a local board, a viewer, and
                a board that is not yet an app and cannot become one all render nothing,
                so the sheet asks it nothing and the section never holds a dead row. The
                sheet closes when the drawer it opened is dismissed, not when the row is
                pressed — closing on press would unmount the drawer with it. */}
            <CanvasAppPanel
              sessionId={persistence === 'server' ? sessionId : null}
              onOpenChange={(panelOpen) => { if (!panelOpen) onClose(); }}
            />
            <button onClick={() => { onExport(); onClose(); }}><span aria-hidden>↓</span>{t('exportCanvas')}</button>
          </CanvasMenuSheet>}
      </div>
  );
});
