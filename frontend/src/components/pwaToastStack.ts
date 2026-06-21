'use client';

import { useEffect, useState } from 'react';

/**
 * Tiny client-side registry that lets the independently-mounted PWA toasts
 * (update-available + install-app) share one bottom-center column instead of
 * rendering at the *same* `bottom: 24` spot and overlapping.
 *
 * Each toast that is currently visible registers its `id` here while mounted;
 * the registry assigns a stable vertical order (lower `priority` sits at the
 * bottom, nearer the viewport edge) and reports each live toast its slot index.
 * A toast multiplies its slot by the row height to offset its own `bottom`, so
 * two live toasts stack rather than collide — and a single live toast sits in
 * the normal bottom position (slot 0). Neither component imports the other.
 *
 * This is presentational-only state (no data), so a module-level store driven
 * through a subscription is the right primitive — mirrors the apiErrorEvent /
 * brainDataEvent buses already used for cross-component coordination.
 */

/** Vertical gap between stacked toasts (toast height + breathing room), in px. */
export const PWA_TOAST_ROW_HEIGHT = 64;

/** Known toast ids with their stacking priority (lower = closer to the edge). */
export type PwaToastId = 'update' | 'install';
const PRIORITY: Record<PwaToastId, number> = { update: 0, install: 1 };

const active = new Set<PwaToastId>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** Slot index (0 = bottom-most) for a live toast, or -1 when not registered. */
function slotOf(id: PwaToastId): number {
  if (!active.has(id)) return -1;
  // Order live toasts by priority and return this id's position in that order.
  const ordered = [...active].sort((a, b) => PRIORITY[a] - PRIORITY[b]);
  return ordered.indexOf(id);
}

/**
 * Register this toast as visible for as long as `visible` is true and return its
 * slot index in the shared stack (0 = bottom-most row). Returns -1 while hidden.
 * Drop-in for a component's render: the returned slot drives a `bottom` offset.
 */
export function usePwaToastSlot(id: PwaToastId, visible: boolean): number {
  const [, force] = useState(0);

  useEffect(() => {
    const rerender = () => force((n) => n + 1);
    listeners.add(rerender);
    return () => {
      listeners.delete(rerender);
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    active.add(id);
    emit();
    return () => {
      active.delete(id);
      emit();
    };
  }, [id, visible]);

  return visible ? slotOf(id) : -1;
}
