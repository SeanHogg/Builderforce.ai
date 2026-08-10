import type { HTMLAttributes, ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'accent' | 'info' | 'success' | 'warning' | 'danger';

export function Badge({ tone = 'neutral', dot = false, className, children, ...props }: {
  tone?: BadgeTone;
  dot?: boolean;
  children: ReactNode;
} & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span {...props} className={`ui-badge ui-badge--${tone}${className ? ` ${className}` : ''}`}>
      {dot && <span className="ui-badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
