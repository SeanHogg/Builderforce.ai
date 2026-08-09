import type { HTMLAttributes, ReactNode } from 'react';

export type SurfaceTone = 'panel' | 'raised' | 'sunken' | 'accent';
export type SurfacePadding = 'none' | 'sm' | 'md' | 'lg';

export type SurfaceOptions = {
  tone?: SurfaceTone;
  padding?: SurfacePadding;
  interactive?: boolean;
};

/**
 * The surface look as a class string, for elements `<Surface>` cannot be.
 *
 * `<Surface>` renders a `<div>`, and a great many real surfaces are not divs: a
 * marketing card that navigates is an `<a>`, an FAQ row is a `<details>`, a
 * screenshot with a caption is a `<figure>`. Without this, each of those either
 * nests a div inside a link (breaking the click target and the a11y tree) or —
 * which is what actually happened across the public pages — re-declares
 * `border: 1px solid var(--border-subtle)` inline for the 634th time.
 *
 * Prefer `<Surface>` when the element IS a div. Reach for this only to put the
 * same look on a different tag, so there is still exactly one definition of what
 * a surface looks like.
 */
export function surfaceClassName(
  { tone = 'panel', padding = 'md', interactive = false }: SurfaceOptions = {},
  className?: string,
) {
  return [
    'ui-surface',
    // `panel` is the default tone and is carried by the base `.ui-surface`
    // rule (background: var(--surface-panel)) — there is no
    // `.ui-surface--panel`, so emitting one would ship a dead class.
    tone === 'panel' ? '' : `ui-surface--${tone}`,
    `ui-surface--pad-${padding}`,
    interactive ? 'ui-surface--interactive' : '',
    className ?? '',
  ].filter(Boolean).join(' ');
}

export function Surface({ tone, padding, interactive, className, children, ...props }: SurfaceOptions & {
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={surfaceClassName({ tone, padding, interactive }, className)}>
      {children}
    </div>
  );
}
