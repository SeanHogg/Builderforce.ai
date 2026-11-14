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
import { isLocalChatModel } from './catalog.js';
/** A picker section. `tools` gathers the rows that may take an agent (tool) turn. */
export const LOCAL_PICKER_GROUPS = ['tools', 'chat', 'coding', 'reasoning', 'math'];
/** The section a row is listed under: a tool-capable row under `tools`, otherwise its
 *  most specific use. Callers pass only chat rows (see {@link isLocalChatModel}). */
export function localPickerGroup(row) {
    if (row.tools)
        return 'tools';
    for (const group of ['coding', 'reasoning', 'math'])
        if (row.uses.includes(group))
            return group;
    return 'chat';
}
export function localPickerView(rows, options = {}) {
    const { fits = () => true, pinned = () => false } = options;
    const byGroup = new Map();
    const more = [];
    const hidden = [];
    for (const row of rows) {
        if (!isLocalChatModel(row))
            continue;
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
//# sourceMappingURL=catalogPicker.js.map