import type { HTMLAttributes, ReactNode } from 'react';

export type SurfaceTone = 'panel' | 'raised' | 'sunken' | 'accent';
export type SurfacePadding = 'none' | 'sm' | 'md' | 'lg';

export function Surface({ tone = 'panel', padding = 'md', interactive = false, className, children, ...props }: {
  tone?: SurfaceTone;
  padding?: SurfacePadding;
  interactive?: boolean;
  children: ReactNode;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={[
        'ui-surface',
        // `panel` is the default tone and is carried by the base `.ui-surface`
        // rule (background: var(--surface-panel)) — there is no
        // `.ui-surface--panel`, so emitting one would ship a dead class.
        tone === 'panel' ? '' : `ui-surface--${tone}`,
        `ui-surface--pad-${padding}`,
        interactive ? 'ui-surface--interactive' : '',
        className ?? '',
      ].filter(Boolean).join(' ')}
    >
      {children}
    </div>
  );
}
