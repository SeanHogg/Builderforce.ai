// No 'use client' directive: this is only ever rendered by `CreationCanvas`, which is
// already a client component, so the boundary is inherited and a second declaration here
// would only add another file to the architecture ratchet's client-component tally.
import { useTranslations } from 'next-intl';
import {
  DiagnosticsIcon,
  DisclosureIcon,
  FullscreenIcon,
  ExitFullscreenIcon,
  OutcomeMetricsIcon,
  PublishCanvasIcon,
  RedoIcon,
  ShareCanvasIcon,
  UndoIcon,
} from '@/components/canvas/CanvasCommands';
import {
  canvasSessionClusters,
  phoneOverflowActions,
  type CanvasSessionActionDef,
  type CanvasSessionActionId,
} from '@/lib/canvasSessionActions';
import styles from './CreationCanvas.module.css';

/**
 * The ONE control set for "what can I do to this canvas".
 *
 * Same argument as `CanvasSurfaceSwitcher`, applied to the other half of the session bar.
 * The registry (`lib/canvasSessionActions.ts`) says which actions exist, which of them
 * belong together, and where each one lives on a phone; this renders that list in the
 * two chromes it can appear in and nothing else decides either question.
 *
 * ── THE TWO CHROMES ──────────────────────────────────────────────────────────────
 * `bar`  — the desktop session bar. Each cluster is a segmented group in a shared
 *          trough, exactly like the surface switcher: the trough is what says "these
 *          three are the same kind of thing", which eight equally-weighted loose
 *          buttons could not say however carefully they were ordered.
 * `menu` — the ••• sheet. It carries every action the phone bar does NOT, so a small
 *          screen loses placement and never loses the action. That used to be a blanket
 *          `display:none` on a class name, which quietly took undo, redo, diagnostics,
 *          the outcome scorecard AND every way to invite anybody off the phone.
 *
 * Both are rendered from the same list at the same time; the stylesheet decides which is
 * on screen, the way the surface switcher's two variants already do.
 */

const ACTION_ICON: Record<CanvasSessionActionId, () => React.JSX.Element> = {
  undo: UndoIcon,
  redo: RedoIcon,
  outcomes: OutcomeMetricsIcon,
  diagnostics: DiagnosticsIcon,
  fullscreen: FullscreenIcon,
  share: ShareCanvasIcon,
  publish: PublishCanvasIcon,
};

/** The glyph for an action that is currently ON, when leaving it needs a different one. */
const ACTIVE_ACTION_ICON: Partial<Record<CanvasSessionActionId, () => React.JSX.Element>> = {
  fullscreen: ExitFullscreenIcon,
};

export interface CanvasSessionActionHandler {
  /** What pressing it does. */
  run: () => void;
  /** Whether the mode is on / the panel this button owns is open. */
  active?: boolean;
  /** True while the session forbids it (a read-only role, a lock). */
  disabled?: boolean;
}

export interface CanvasSessionActionsProps {
  handlers: Record<CanvasSessionActionId, CanvasSessionActionHandler>;
  variant: 'bar' | 'menu';
}

export function CanvasSessionActions({ handlers, variant }: CanvasSessionActionsProps) {
  const t = useTranslations('creationCanvas');

  /** Name, hover text and ARIA state — decided once, for both chromes. */
  const describe = (def: CanvasSessionActionDef) => {
    const handler = handlers[def.id];
    const active = handler?.active === true;
    const labelKey = active && def.activeLabelKey ? def.activeLabelKey : def.labelKey;
    const label = t(labelKey as 'share');
    return {
      handler,
      active,
      label,
      title: def.titleKey ? t(def.titleKey as 'share') : label,
      // A command that is over needs neither attribute; a mode needs `pressed` and a
      // panel needs `expanded`. The registry decides which, so no call site has to
      // remember that full screen is a mode and the invite sheet is not.
      'aria-pressed': def.state === 'pressed' ? active : undefined,
      'aria-expanded': def.state === 'expanded' ? active : undefined,
    };
  };

  if (variant === 'menu') {
    // Words, always. The sheet has room for them and a phone user pressing ••• is
    // looking for a named thing, not scanning a second row of glyphs.
    return <>
      {phoneOverflowActions().map((def) => {
        const { handler, active, label, title, ...aria } = describe(def);
        const Glyph = (active && ACTIVE_ACTION_ICON[def.id]) || ACTION_ICON[def.id];
        // No class of its own: chrome comes from `.moreMenu button`, so a session action
        // and a session tool are the same kind of row in the sheet rather than two
        // visitors' idea of one.
        return <button
          key={def.id}
          type="button"
          disabled={handler?.disabled}
          title={title}
          onClick={() => handler?.run()}
          {...aria}
        ><span aria-hidden><Glyph /></span>{label}</button>;
      })}
    </>;
  }

  return <>
    {canvasSessionClusters().map(({ cluster, actions }) => {
      const buttons = actions.map((def) => {
        const { handler, active, label, title, ...aria } = describe(def);
        const Glyph = (active && ACTIVE_ACTION_ICON[def.id]) || ACTION_ICON[def.id];

        // The worded actions. They open somewhere else rather than acting on the board,
        // and "Share" and "Publish" are promises a glyph cannot make — the same reason
        // the surface tabs carry their names on a desktop.
        if (def.chrome === 'labelled') return <button
          key={def.id}
          type="button"
          className={styles.sessionActionLabelled}
          // The product tour anchors on Share specifically. Keyed off the id rather than
          // the chrome, or the second worded action would silently steal the anchor.
          {...(def.id === 'share' ? { 'data-tour': 'creation-share' } : {})}
          // Published so the phone breakpoint stands down exactly the actions the
          // registry moved into the ••• sheet — one declaration, read by the
          // stylesheet as well as by the sheet, rather than a second list in CSS.
          data-phone={def.phone}
          disabled={handler?.disabled}
          title={title}
          onClick={() => handler?.run()}
          {...aria}
        ><Glyph /><span>{label}</span><i aria-hidden><DisclosureIcon /></i></button>;

        return <button
          key={def.id}
          type="button"
          className={styles.sessionActionButton}
          data-phone={def.phone}
          disabled={handler?.disabled}
          aria-label={label}
          title={title}
          onClick={() => handler?.run()}
          {...aria}
        ><Glyph /></button>;
      });

      // A cluster of one is not a set, so it gets no trough — a lone button in a
      // segmented shell reads as a group with a member missing.
      if (actions.length < 2) return <div key={cluster} className={styles.sessionActionSolo}>{buttons}</div>;

      return <div
        key={cluster}
        className={styles.sessionActionCluster}
        role="group"
        aria-label={t(`sessionActionCluster.${cluster}` as 'sessionActionCluster.history')}
      >{buttons}</div>;
    })}
  </>;
}
