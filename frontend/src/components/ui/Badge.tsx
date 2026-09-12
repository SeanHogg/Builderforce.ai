import type { HTMLAttributes, ReactNode } from 'react';
import type { StatusTone } from '@/lib/statusTone';

/** The badge tones ARE the status tones — a `lib/statusTone` map feeds `<Badge tone>` directly. */
export type BadgeTone = StatusTone;

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
