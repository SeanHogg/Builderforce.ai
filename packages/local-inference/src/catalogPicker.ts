/**
 * How a picker lays the page-engine catalog out — the ONE rule every host's on-device
 * list renders (the web composer, the editor's webview, Rovr's side panel all reach it
 * through brain-ui's `LocalModelList`).
 *
 * Eighty-odd downloadable builds is a catalog, not a menu. So a picker shows the curated
 * rows first, grouped by what they are for, and keeps the rest behind "All models":
 *  - only CHAT rows are offered (`isLocalChatModel`): embedding builds feed the embedder,
 *    vision-only builds wait for image input;
 *  - a row this device cannot run is HIDDEN from the sections — a caller passes `fits`,
 *    and the hidden rows come back (behind "All models", each with its reason, and for
 *    the "nothing runs here, because …" notice);
 *  - a row the person already has (downloaded, downloading, pinned) is ALWAYS listed in
 *    its group — even when this device cannot run it, so it shows why and can still be
 *    removed — a caller passes `pinned`.
 *
 * Generic over the row type so a host's richer row (brain-embedded's `LocalModelRow`,
 * with its download state) passes through untouched. Pure.
 */

import { isLocalChatModel, type LocalCatalogModel } from './catalog.js';

/** A picker section. `tools` gathers the rows that may take an agent (tool) turn. */
export const LOCAL_PICKER_GROUPS = ['tools', 'chat', 'coding', 'reasoning', 'math'] as const;
export type LocalPickerGroup = (typeof LOCAL_PICKER_GROUPS)[number];

export type LocalPickerRow = Pick<LocalCatalogModel, 'uses' | 'recommended' | 'tools'>;

export interface LocalPickerView<T> {
  /** The curated (and pinned) rows by section, in `LOCAL_PICKER_GROUPS` order; empty
   *  sections omitted. */
  groups: Array<{ group: LocalPickerGroup; rows: T[] }>;
  /** Every other offered row, catalog order — behind "All models". */
  more: T[];
  /** Chat rows refused by `fits` that the person does not hold — listed behind "All
   *  models" with their reason, and for the "nothing runs here, because …" notice. */
  hidden: T[];
}

export interface LocalPickerOptions<T> {
  /** Can this device run the row? Default: every row fits. */
  fits?: (row: T) => boolean;
  /** Lift the row out of "All models" (already downloaded, downloading, or pinned). */
  pinned?: (row: T) => boolean;
}

/** The section a row is listed under: a tool-capable row under `tools`, otherwise its
 *  most specific use. Callers pass only chat rows (see {@link isLocalChatModel}). */
export function localPickerGroup(row: LocalPickerRow): LocalPickerGroup {
  if (row.tools) return 'tools';
  for (const group of ['coding', 'reasoning', 'math'] as const) if (row.uses.includes(group)) return group;
  return 'chat';
}

export function localPickerView<T extends LocalPickerRow>(
  rows: readonly T[],
  options: LocalPickerOptions<T> = {},
): LocalPickerView<T> {
  const { fits = () => true, pinned = () => false } = options;
  const byGroup = new Map<LocalPickerGroup, T[]>();
  const more: T[] = [];
  const hidden: T[] = [];
  for (const row of rows) {
    if (!isLocalChatModel(row)) continue;
    const held = pinned(row);
    if (!fits(row) && !held) {
      hidden.push(row);
      continue;
    }
    if (!row.recommended && !held) {
      more.push(row);
      continue;
    }
    const group = localPickerGroup(row);
    byGroup.set(group, [...(byGroup.get(group) ?? []), row]);
  }
  const groups = LOCAL_PICKER_GROUPS.flatMap((group) => {
    const listed = byGroup.get(group);
    return listed ? [{ group, rows: listed }] : [];
  });
  return { groups, more, hidden };
}
