import type { ComponentDef, ComponentMount } from './types';
import { supportsMount } from './types';
import { ALL_COMPONENTS } from './allComponents';

/**
 * The populated app-wide component registry. {@link ALL_COMPONENTS} is the single
 * aggregation point every surface adds its module to (see allComponents.ts); this
 * file turns that list into the lookup, the grouping and the per-mount filter that
 * every adapter reads.
 *
 * ONE source of truth — a component id resolves the same way for the home
 * dashboard, a custom dashboard, the Brain, a saved pin, a board card and an
 * embedded frame inside somebody's published app. That is the whole point: the
 * three registries this replaced could disagree about what a component was, and
 * the ported capabilities landed in none of them.
 */

const BY_ID = new Map<string, ComponentDef>(ALL_COMPONENTS.map((c) => [c.id, c]));

/** Resolve a component by id (the pin key / saved `widget_key` / embed path / canvas `componentId`). */
export function getComponent(id: string): ComponentDef | undefined {
  return BY_ID.get(id);
}

export function hasComponent(id: string): boolean {
  return BY_ID.has(id);
}

/** Every registered component, registration order preserved. */
export function listComponents(): ComponentDef[] {
  return ALL_COMPONENTS;
}

/**
 * The components a given mount may render.
 *
 * Every adapter goes through here rather than filtering `mounts` itself, so
 * "which components can a board show" has exactly one answer and adding a mount
 * does not mean auditing every consumer for a missed check.
 */
export function listComponentsForMount(mount: ComponentMount): ComponentDef[] {
  return ALL_COMPONENTS.filter((c) => supportsMount(c, mount));
}

/** Resolve a component by id, but only if it may render at `mount`. Returns
 *  undefined for an id that exists and is not mountable there — which is what a
 *  board card holding a dashboard-only id, or an `/embed/<id>` for a component
 *  that never opted into `app`, must both see. */
export function getComponentForMount(id: string, mount: ComponentMount): ComponentDef | undefined {
  const def = BY_ID.get(id);
  return def && supportsMount(def, mount) ? def : undefined;
}

export interface ComponentGroup {
  /** i18n key under `components.group`. */
  group: string;
  components: ComponentDef[];
}

/**
 * Components bucketed by their source surface — drives every picker.
 *
 * Takes the mount so the board's palette and the dashboard's picker are the same
 * function rather than two groupings that drift. Omitting it groups everything.
 */
export function listComponentGroups(mount?: ComponentMount): ComponentGroup[] {
  const source = mount ? listComponentsForMount(mount) : ALL_COMPONENTS;
  const order: string[] = [];
  const map = new Map<string, ComponentDef[]>();
  for (const c of source) {
    if (!map.has(c.group)) { map.set(c.group, []); order.push(c.group); }
    map.get(c.group)!.push(c);
  }
  return order.map((group) => ({ group, components: map.get(group)! }));
}
