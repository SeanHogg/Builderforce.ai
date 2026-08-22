'use client';

/**
 * A PLATFORM COMPONENT, MOUNTED ON THE BOARD — the canvas adapter.
 *
 * ── WHAT THIS IS ─────────────────────────────────────────────────────────────
 * The card renders the SAME component the app renders and the same one an
 * entrepreneur embeds in the product they publish: one declaration in
 * `lib/components/registry.ts`, addressed here by `componentId`. Not a preview,
 * not a screenshot, not a second implementation drawn for the board — the live,
 * tenant-scoped surface, on the canvas.
 *
 * That is what makes a board a place a business is RUN rather than only
 * described. A CRM board and a marketing-pipeline board are not new kinds; they
 * are boards somebody composed out of these.
 *
 * ── WHY THIS FILE OWNS ALMOST NOTHING ────────────────────────────────────────
 * An adapter's whole job is to be thin. It resolves an id against the registry,
 * refuses ids that did not opt into the `canvas` mount, and gives the component a
 * scroll box and a window. Everything else — the data, the entitlement, the empty
 * and error states — belongs to the component, which is the property that let it
 * arrive here from a dashboard with no edits and will let the next one arrive
 * from somewhere else.
 *
 * Choosing is not this file's either: the catalogue is `ComponentPicker`, the
 * same panel the dashboard browses. This supplies the errand ("use this one")
 * and writes the result onto the node.
 *
 * ── WHY THE MOUNT IS CHECKED AND NOT ASSUMED ─────────────────────────────────
 * `getComponentForMount(id, 'canvas')` refuses a component that never declared
 * the canvas mount, so a dashboard-only tile pasted onto a board by id shows the
 * unavailable notice instead of rendering something never designed for a card.
 * The alternative — resolving by id alone — is how the embed route ended up
 * serving blank frames for keys its switch had no branch for.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { getComponentForMount } from '@/lib/components/registry';
import { useComponentLabel } from '@/lib/components/useComponentCatalog';
import { ComponentScopeProvider } from '@/lib/components/scope';
import { ComponentPicker } from '@/components/component-picker/ComponentPicker';
import { ComponentChooseAction } from '@/components/component-picker/ComponentChooseAction';
import type { ComponentDef } from '@/lib/components/types';
import type { CreationNodeData } from './types';
import styles from './CreationCanvas.module.css';

/**
 * The window a board card reads over.
 *
 * A card has no range picker of its own — the board is a composition surface,
 * not a dashboard — so it opens on the same default the dashboard does. When a
 * card needs its own window it becomes an authorable field, not a prop the
 * canvas guesses at.
 */
const CARD_WINDOW_DAYS = 30;

/** The title `createData` gives a fresh card. A card still wearing it has not
 *  been named by anybody, so picking a component may name it. */
const UNNAMED_TITLE = 'Component';

export function CanvasComponentBody({
  data,
  onEdit,
}: {
  data: CreationNodeData;
  /** Absent on a read-only board (a shared link, a published page), which is
   *  exactly when nobody should be able to change what a card shows. The choose
   *  affordance is therefore absent with it rather than gated by a flag. */
  onEdit?: (patch: Partial<CreationNodeData>) => void;
}) {
  const t = useTranslations('components.canvas');
  const labelOf = useComponentLabel();
  const [picking, setPicking] = useState(false);

  const componentId = typeof data.componentId === 'string' ? data.componentId.trim() : '';
  const projectId = typeof data.projectId === 'number' && data.projectId > 0 ? data.projectId : null;
  const def = componentId ? getComponentForMount(componentId, 'canvas') : undefined;
  const title = typeof data.title === 'string' ? data.title : '';

  /**
   * Whether picking a component may also rename the card.
   *
   * True when nobody has named it — it is empty, still carries the created
   * default, or carries the CURRENT component's own label because a previous pick
   * set it. A title the author typed is never overwritten, which is the only rule
   * that matters here: silently discarding somebody's words is worse than a card
   * called "Component".
   */
  const mayRename = !title || title === UNNAMED_TITLE || (def != null && title === labelOf(def));

  const choose = (chosen: ComponentDef) => {
    onEdit?.({
      componentId: chosen.id,
      ...(mayRename ? { title: labelOf(chosen) } : {}),
    });
    setPicking(false);
  };

  return (
    <>
      {def
        ? (
          // The card's project wins over anything ambient: a board can hold two
          // of these scoped to two different projects, and the app shell's
          // current selection must not silently retarget either of them.
          <ComponentScopeProvider projectId={projectId}>
            <div className={`${styles.transclusionBody} nowheel`}>
              <def.Surface days={CARD_WINDOW_DAYS} />
            </div>
          </ComponentScopeProvider>
        )
        : (
          <p className={styles.transclusionNotice} {...(componentId ? { role: 'alert' as const } : {})}>
            {componentId ? t('unknown') : t('empty')}
          </p>
        )}

      {onEdit && (
        <>
          <button
            type="button"
            className="nodrag"
            onClick={(e) => { e.stopPropagation(); setPicking(true); }}
            style={CHOOSE_BUTTON}
          >
            {def ? t('change') : t('choose')}
          </button>
          <ComponentPicker
            open={picking}
            onClose={() => setPicking(false)}
            mount="canvas"
            title={`◲ ${t('pickTitle')}`}
            action={(candidate) => (
              <ComponentChooseAction def={candidate} current={componentId} onChoose={choose} />
            )}
          />
        </>
      )}
    </>
  );
}

const CHOOSE_BUTTON: React.CSSProperties = {
  alignSelf: 'flex-start',
  marginTop: 6,
  minHeight: 30,
  padding: '4px 10px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border-subtle)',
  background: 'transparent',
  color: 'var(--text-primary)',
  cursor: 'pointer',
  fontSize: '0.78rem',
};
