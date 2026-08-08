'use client';

import { useEffect, useState } from 'react';

/**
 * Tiny client-side registry that lets the independently-mounted PWA toasts
 * (update-available + install-app) share one bottom-center column instead of
 * rendering at the *same* `bottom: 24` spot and overlapping.
 *
 * Each toast that is currently visible registers its `id` here while mounted;
 * the registry assigns a stable vertical order (lower `priority` sits nearer the
 * anchored viewport edge) and reports each live toast its slot index. The slot
 * drives an offset in `AppToast.module.css`, so two live toasts stack rather
 * than collide — and a single live toast sits in the normal position (slot 0).
 * Neither component imports the other. The row height is the stylesheet's to
 * decide: a phone anchors these to a different edge, at a different height.
 *
 * This is presentational-only state (no data), so a module-level store driven
 * through a subscription is the right primitive — mirrors the apiErrorEvent /
 * brainDataEvent buses already used for cross-component coordination.
 */

/** Known toast ids with their stacking priority (lower = closer to the edge). */
export type AppToastId = 'update' | 'install' | 'resume';
const PRIORITY: Record<AppToastId, number> = { update: 0, resume: 1, install: 2 };

const active = new Set<AppToastId>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/**
 * Pure: given the set of currently-live toast ids, the slot index (0 = bottom-most)
 * for `id`, or -1 when `id` is not live. Lower-priority toasts sit nearer the
 * viewport edge (slot 0). Exported for unit testing the stacking order.
 */
export function computeSlot(liveIds: Iterable<AppToastId>, id: AppToastId): number {
  const ordered = [...liveIds].sort((a, b) => PRIORITY[a] - PRIORITY[b]);
  return ordered.indexOf(id);
}

/** Slot index (0 = bottom-most) for a live toast, or -1 when not registered. */
function slotOf(id: AppToastId): number {
  if (!active.has(id)) return -1;
  return computeSlot(active, id);
}

/**
 * Register this toast as visible for as long as `visible` is true and return its
 * slot index in the shared stack (0 = bottom-most row). Returns -1 while hidden.
 * Drop-in for a component's render: the returned slot drives a `bottom` offset.
 */
export function useAppToastSlot(id: AppToastId, visible: boolean): number {
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
