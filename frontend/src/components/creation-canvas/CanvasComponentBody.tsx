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
 * ── WHY THE MOUNT IS CHECKED AND NOT ASSUMED ─────────────────────────────────
 * `getComponentForMount(id, 'canvas')` refuses a component that never declared
 * the canvas mount, so a dashboard-only tile pasted onto a board by id shows the
 * unavailable notice instead of rendering something never designed for a card.
 * The alternative — resolving by id alone — is how the embed route ended up
 * serving blank frames for keys its switch had no branch for.
 */

import { useTranslations } from 'next-intl';
import { getComponentForMount } from '@/lib/components/registry';
import { ComponentScopeProvider } from '@/lib/components/scope';
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

export function CanvasComponentBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('components.canvas');
  const componentId = typeof data.componentId === 'string' ? data.componentId.trim() : '';
  const projectId = typeof data.projectId === 'number' && data.projectId > 0 ? data.projectId : null;

  if (!componentId) return <p className={styles.transclusionNotice}>{t('empty')}</p>;

  const def = getComponentForMount(componentId, 'canvas');
  if (!def) return <p className={styles.transclusionNotice} role="alert">{t('unknown')}</p>;

  const { Surface } = def;
  return (
    // The card's project wins over anything ambient: a board can hold two of
    // these scoped to two different projects, and the app shell's current
    // selection must not silently retarget either of them.
    <ComponentScopeProvider projectId={projectId}>
      <div className={styles.transclusionBody}>
        <Surface days={CARD_WINDOW_DAYS} />
      </div>
    </ComponentScopeProvider>
  );
}
