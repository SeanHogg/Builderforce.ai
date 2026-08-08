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
        `ui-surface--${tone}`,
        `ui-surface--pad-${padding}`,
        interactive ? 'ui-surface--interactive' : '',
        className ?? '',
      ].filter(Boolean).join(' ')}
    >
      {children}
    </div>
  );
}
