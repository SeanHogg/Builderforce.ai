'use client';

/**
 * The invitation a signed-out visitor sees where content that needs an account
 * would have been.
 *
 * ── WHY IT EXISTS ────────────────────────────────────────────────────────────
 * A guest may open every route; that is the product's choice, so that the thing
 * they are deciding to sign up for is the thing in front of them. Some reads
 * have no sample-workspace fixture and come back 401. That rejection used to be
 * rendered VERBATIM — `Missing or malformed Authorization header`, in a red box,
 * on `/investor` and a few hundred sibling surfaces — which is a sentence about
 * an HTTP header addressed to a person who simply has no account yet. The
 * right thing to show them is what an account unlocks, with the way in.
 *
 * ── WHY IT DECIDES ITS OWN VISIBILITY ────────────────────────────────────────
 * The condition is one fact — "a read on this route was refused for want of a
 * credential" — and the transport is the only thing that knows it, so it is
 * recorded once in `guestWall` and read here. No surface passes a boolean, no
 * surface has to recognise the rejection, and a surface that has never heard of
 * this component is still covered by the copy the shell mounts.
 *
 * Two placements, ONE rule about how many a visitor sees:
 *
 *   inline  — mounted by a section that met the wall (`SectionError`), so the
 *             invitation stands exactly where the rows would have been.
 *   shell   — mounted once by `AppShell` above every page. It stands down while
 *             an inline one is showing, and otherwise catches every surface that
 *             only ever turned the rejection into a string.
 *
 * The buttons and their `next` handling are `GuestSignupCta`, THE conversion
 * call-to-action, not a second pair.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { GuestSignupCta } from '@/components/GuestSignupCta';
import { useSampleWorkspace } from '@/domains/guest/presentation/useSampleWorkspace';
import {
  claimInlinePrompt,
  readGuestWall,
  resetGuestWall,
  subscribeGuestWall,
} from '@/domains/guest/application/guestWall';

export interface GuestAccountPromptProps {
  /** Where this copy stands — see the module note. Defaults to `inline`. */
  placement?: 'inline' | 'shell';
  className?: string;
  style?: React.CSSProperties;
}

const card: React.CSSProperties = {
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)',
  overflow: 'hidden',
  margin: '12px 0',
};

/** Is the visitor standing on the route where a read was refused? */
function useMetWall(): { met: boolean; inline: number } {
  const pathname = usePathname() || '/';
  const wall = useSyncExternalStore(subscribeGuestWall, readGuestWall, resetGuestWall);
  return { met: wall.pathname === pathname, inline: wall.inline };
}

export function GuestAccountPrompt({ placement = 'inline', className, style }: GuestAccountPromptProps) {
  const { ready, signedIn } = useSampleWorkspace();
  const { met, inline } = useMetWall();
  const pathname = usePathname() || '/';
  const t = useTranslations('guest');

  const showing = ready && !signedIn && met;
  const isInline = placement === 'inline';
  useEffect(() => {
    if (!showing || !isInline) return undefined;
    return claimInlinePrompt();
  }, [showing, isInline]);

  if (!showing) return null;
  if (!isInline && inline > 0) return null;

  return (
    <div className={className} style={{ ...card, ...style }} role="status" data-guest-wall={placement}>
      <GuestSignupCta prompt={{ next: pathname }} title={t('wall.title')} body={t('wall.body')} />
    </div>
  );
}
