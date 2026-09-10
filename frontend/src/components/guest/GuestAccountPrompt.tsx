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
 *   shell   — mounted once by `AppShell` over every page, as a CENTRED MODAL. It
 *             stands down while an inline one is showing, and otherwise catches
 *             every surface that only ever turned the rejection into a string.
 *
 * ── WHY THE SHELL COPY IS A MODAL ────────────────────────────────────────────
 * It used to render in flow at the top of the page, which is right for a page
 * that scrolls and wrong for one that does not. On a full-screen surface — the
 * Creation Canvas, where a guest opening `Room` meets the wall — there is no
 * flow to sit at the top of, so the card came to rest in the free corner beside
 * the Brain panel: small, cornered, indistinguishable from the canvas's own
 * chrome, and easy to read as a tooltip about something else. The inline
 * placement has a place of its own to stand; the catch-all does not, so it takes
 * the centre and dims what is behind it.
 *
 * It is DISMISSIBLE — backdrop, Escape, or `PanelCloseButton`, the app's ONE
 * dismiss control — because a guest
 * may open every route and the invitation is an invitation, not a gate. The
 * dismissal is recorded on `guestWall` so the next refused read on the same
 * route does not put it straight back up.
 *
 * The buttons and their `next` handling are `GuestSignupCta`, THE conversion
 * call-to-action, not a second pair; the overlay is `ModalOverlay`, THE centred
 * overlay, not a second one.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { GuestSignupCta } from '@/components/GuestSignupCta';
import { ModalOverlay } from '@/components/ui/ModalOverlay';
import { PanelCloseButton } from '@/components/PanelCloseButton';
import { useSampleWorkspace } from '@/domains/guest/presentation/useSampleWorkspace';
import {
  claimInlinePrompt,
  dismissGuestWall,
  readGuestWall,
  resetGuestWall,
  subscribeGuestWall,
} from '@/domains/guest/application/guestWall';
import styles from './GuestAccountPrompt.module.css';

export interface GuestAccountPromptProps {
  /** Where this copy stands — see the module note. Defaults to `inline`. */
  placement?: 'inline' | 'shell';
  className?: string;
  style?: React.CSSProperties;
}

/** Is the visitor standing on the route where a read was refused? */
function useMetWall(): { met: boolean; inline: number; dismissed: boolean } {
  const pathname = usePathname() || '/';
  const wall = useSyncExternalStore(subscribeGuestWall, readGuestWall, resetGuestWall);
  return {
    met: wall.pathname === pathname,
    inline: wall.inline,
    dismissed: wall.dismissed === pathname,
  };
}

export function GuestAccountPrompt({ placement = 'inline', className, style }: GuestAccountPromptProps) {
  const { ready, signedIn } = useSampleWorkspace();
  const { met, inline, dismissed } = useMetWall();
  const pathname = usePathname() || '/';
  const t = useTranslations('guest');
  const tCommon = useTranslations('common');
  const onDismiss = useCallback(() => { dismissGuestWall(); }, []);

  const showing = ready && !signedIn && met;
  const isInline = placement === 'inline';
  useEffect(() => {
    if (!showing || !isInline) return undefined;
    return claimInlinePrompt();
  }, [showing, isInline]);

  if (!showing) return null;

  const invitation = (
    <GuestSignupCta prompt={{ next: pathname }} title={t('wall.title')} body={t('wall.body')} />
  );

  if (isInline) {
    return (
      <div
        className={className ? `${styles.inline} ${className}` : styles.inline}
        style={style}
        role="status"
        data-guest-wall="inline"
      >
        {invitation}
      </div>
    );
  }

  // The catch-all stands down entirely while a section is saying it in place, and
  // once this visitor has closed it on this route.
  if (inline > 0 || dismissed) return null;

  return (
    <ModalOverlay
      onDismiss={onDismiss}
      label={t('wall.title')}
      overlayProps={{ 'data-guest-wall-overlay': 'shell' }}
    >
      <div
        className={className ? `${styles.card} ${className}` : styles.card}
        style={style}
        data-guest-wall="shell"
      >
        <div className={styles.closeSlot}>
          <PanelCloseButton onClose={onDismiss} label={tCommon('close')} />
        </div>
        {invitation}
      </div>
    </ModalOverlay>
  );
}
