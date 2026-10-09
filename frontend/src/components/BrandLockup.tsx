// No `'use client'`: no state and no hooks, so it belongs to whichever side of
// the boundary imports it — the marketing header is a client component, the
// Studio bar is reached from one, and a directive here would be redundant.

import type { MouseEvent, ReactNode } from 'react';
import Link from 'next/link';
import MascotIcon from '@/components/MascotIcon';

/**
 * The brand lockup: the mark, then whatever wordmark the surface wears.
 *
 * The mark itself is `MascotIcon`, which already existed and already said it
 * was the one place the brand mark lives. It was used by two files while seven
 * others hardcoded `/agentHost.png`, so this composes it rather than declaring
 * a second mark beside it.
 *
 * It exists because Studio shipped without the mark at all. Its bar hand-rolled
 * `Builderforce <span accent>Studio</span>` — no icon, and the second word in
 * the accent blue, so the one place a visitor lands from `studio.builderforce.ai`
 * showed a wordmark the brand does not have. The header had the real lockup ten
 * files away; nothing connected the two, so nothing could notice.
 *
 * The WORDMARK is `children`, not a prop with a variant switch: the surfaces
 * genuinely differ — the header carries `Builderforce.ai` plus a beta badge,
 * Studio carries `Builderforce Studio` — and that is composition, not a branch
 * this component should own. What it DOES own is the part that must never
 * differ: which image is the mark, that the mark comes first, and the glow.
 *
 * `className` lets a caller keep its own layout CSS (`.mh-brand` has the
 * marketing bar's spacing rules); without one the lockup styles itself.
 */
export function BrandLockup({
  href,
  label,
  size = 30,
  className,
  markClassName = 'bf-mark-glow',
  onClick,
  children,
}: {
  /** Where the lockup goes. It IS the home link for its surface. */
  href: string;
  /** Accessible name — the mark is decorative, so the link must carry one. */
  label: string;
  size?: number;
  className?: string;
  /** The mark's own styling, when a surface needs more than the glow — the
   *  footer's mark floats and pauses on hover, which is real and not drift. */
  markClassName?: string;
  /** Navigating away from an open mobile drawer has to close it. On the LINK,
   *  not on the wordmark: a tap on the mark is a tap on the lockup. Gets the event,
   *  so a surface that must ask before leaving can hold the navigation. */
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      className={className}
      onClick={onClick}
      style={
        className
          ? undefined
          : { display: 'inline-flex', alignItems: 'center', gap: 10, textDecoration: 'none', flexShrink: 0 }
      }
    >
      <MascotIcon size={size} className={markClassName} />
      {children}
    </Link>
  );
}
