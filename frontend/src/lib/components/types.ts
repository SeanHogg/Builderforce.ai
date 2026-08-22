import type { ComponentType } from 'react';
import type { Capability } from '@/lib/rbac';
import type { Domain } from '@/lib/kernel/kernelApi';

/**
 * THE COMPONENT — one declaration, three places it can be mounted.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────
 * "A reusable component" existed three times in this codebase under three names,
 * and a capability ported from hired.video or BurnRateOS landed in none of them:
 *
 *   `WidgetDef`    (lib/widgets/types.ts)   — mountable on a dashboard, a pin,
 *                                             the Brain. Correctly open/closed.
 *   `EMBED_VIEWS`  (builderforce-embedded)  — mountable in a HOST app, but
 *                                             resolved by a 13-branch switch over
 *                                             ~20 hand-written imports.
 *   canvas kinds   (creationObjectRegistry) — mountable on a board.
 *
 * Nothing joined them, so a ported capability became a PAGE under `app/*` and was
 * reachable from exactly one surface: ours. An entrepreneur could not drop the
 * CRM, the hiring funnel or the marketing pipeline onto their own canvas or into
 * their own published app, because no unit existed that could be dropped anywhere.
 *
 * ── WHY THIS SHAPE ───────────────────────────────────────────────────────────
 * `WidgetDef` was already most of the way there — it reads its own data, gates
 * itself, and takes nothing from its parent but a window. What it lacked was
 * anywhere else to go. So this is that type with the two fields that make a
 * component portable, and nothing else invented:
 *
 *   `domain`  — the kernel domain it reads. Multi-tenant and project scoping are
 *               a property of the DOMAIN, not of the mount, which is what makes
 *               the same component safe on a board and inside a published app:
 *               its data was never addressed any other way. It is also what a
 *               published app's handler declares against (`entity` step), so the
 *               registry and the data path check the same word.
 *   `mounts`  — where it may be rendered. Data, not a branch: a new mount is an
 *               adapter that filters this list, and a component opts in by naming
 *               it. Nothing asks "is this a widget or a view" ever again.
 *
 * ── WHY THE SURFACE STILL TAKES `days` ───────────────────────────────────────
 * It is the render window, not a capability flag — the one thing a mount legitimately
 * knows that the component cannot (a dashboard has a global range picker, a board
 * card has its own). Everything else a component needs it resolves itself:
 * entitlement through `capability`, project through `useComponentProjectId`, data
 * through a typed client. No mount passes a `canX` boolean, and no component reaches
 * into its parent for context it should own.
 */

/** Where a component may be rendered. A new mount is an adapter, not a branch. */
export const COMPONENT_MOUNTS = ['dashboard', 'canvas', 'app'] as const;
export type ComponentMount = (typeof COMPONENT_MOUNTS)[number];

export function isComponentMount(value: string): value is ComponentMount {
  return (COMPONENT_MOUNTS as readonly string[]).includes(value);
}

export type ComponentSize = 'sm' | 'md' | 'lg';

/** Where a component drills to for the full report (a slide-out side panel). */
export type ComponentDrill =
  /** Open the source hub's slide-out lens in place. */
  | { kind: 'panel'; hub: 'ai' | 'delivery' | 'finance' | 'devex'; panel: string }
  /** Navigate to a route (used by non-insights surfaces). */
  | { kind: 'route'; href: string };

/**
 * Props every component Surface receives.
 *
 * Exactly one field, and it stays that way on purpose: the moment a mount can
 * hand a component something else, components start differing by mount and the
 * portability this registry exists for is gone.
 */
export interface ComponentSurfaceProps {
  days: number;
}

export interface ComponentDef {
  /** Stable global id — the pin key, the saved `widget_key`, the `/embed/<id>`
   *  path segment, and the `componentId` a canvas card stores. One id everywhere,
   *  so a pinned copy, a board card and an embedded frame are the same thing. */
  id: string;
  /** i18n key under `components.group` for the source-surface label (groups the picker). */
  group: string;
  /** i18n key under `components.title`. */
  titleKey: string;
  /** Optional one-line description i18n key under `components.desc`. */
  descKey?: string;
  /** The kernel domain whose data this reads. Absent only for a component that
   *  reads no tenant-owned domain data at all (a clock, a note). */
  domain?: Domain;
  /** Capability that gates the content (the Surface self-gates via <RoleGate>). */
  capability?: Capability;
  /** Grid span hint: sm = 1 col, md = wide, lg = full row. Default 'sm'. */
  size?: ComponentSize;
  /** The component. Renders ONLY its body — frame, title and pin are mount chrome. */
  Surface: ComponentType<ComponentSurfaceProps>;
  /** Optional "open the full report" drill-down. Dashboard mount only; other
   *  mounts have no side panel to open and ignore it. */
  drill?: ComponentDrill;
  /** Where this may be mounted. Defaults to `['dashboard']` via {@link mountsOf}
   *  so the 129 components that predate portability keep their exact behaviour. */
  mounts?: readonly ComponentMount[];
}

/** The mounts a component supports, with the default applied. Read this rather
 *  than `def.mounts` so the default lives in one place. */
export function mountsOf(def: ComponentDef): readonly ComponentMount[] {
  return def.mounts ?? DEFAULT_MOUNTS;
}

const DEFAULT_MOUNTS: readonly ComponentMount[] = ['dashboard'];

/** Whether a component may be rendered at a given mount. */
export function supportsMount(def: ComponentDef, mount: ComponentMount): boolean {
  return mountsOf(def).includes(mount);
}
