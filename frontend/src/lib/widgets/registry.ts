import type { WidgetDef } from './types';
import { ALL_WIDGETS } from './allWidgets';

/**
 * The populated app-wide widget registry. {@link ALL_WIDGETS} is the single
 * aggregation point every surface adds its widget module to (see allWidgets.ts);
 * this file turns that list into the lookup + grouping the dashboard, picker, and
 * pin layer read. One source of truth — a widget id resolves the same way for the
 * home dashboard, a custom dashboard, the Brain, and a saved pin.
 */

const BY_ID = new Map<string, WidgetDef>(ALL_WIDGETS.map((w) => [w.id, w]));

/** Resolve a widget by id (the pin key / saved `widget_key`). */
export function getWidget(id: string): WidgetDef | undefined {
  return BY_ID.get(id);
}

export function hasWidget(id: string): boolean {
  return BY_ID.has(id);
}

/** Every registered widget, registration order preserved. */
export function listWidgets(): WidgetDef[] {
  return ALL_WIDGETS;
}

export interface WidgetGroup {
  /** i18n key under `widgets.group`. */
  group: string;
  widgets: WidgetDef[];
}

/** Widgets bucketed by their source surface — drives the Add-widget picker. */
export function listWidgetGroups(): WidgetGroup[] {
  const order: string[] = [];
  const map = new Map<string, WidgetDef[]>();
  for (const w of ALL_WIDGETS) {
    if (!map.has(w.group)) { map.set(w.group, []); order.push(w.group); }
    map.get(w.group)!.push(w);
  }
  return order.map((group) => ({ group, widgets: map.get(group)! }));
}
