'use client';

import { useTranslations } from 'next-intl';
import { ShareLinkField } from '@/components/share/ShareLinkField';
import { guestRoomInviteUrl, type GuestRoomSurface } from '@/lib/guestRoomApi';

/**
 * The invite link for a shared FREE session — the ONE place that link is built.
 *
 * Both surfaces that can host a room render this: the guest chat's room bar and the
 * Creation Canvas share menu. They differ in chrome, not in behaviour, and a second
 * copy would be a second chance to point the link at the wrong surface.
 *
 * The field, the copy button and the refused-clipboard fallback are `ShareLinkField`,
 * shared with the signed-in canvas invite link — the two share motions produce the same
 * kind of thing (a URL you forward) and had started to produce two different controls
 * for it. What is left here is the only thing that is actually guest-room specific:
 * which URL, and why it might not be sendable.
 */
export function GuestInviteLink({
  code, surface, full = false, compact = false,
}: {
  code: string;
  surface: GuestRoomSurface;
  /** The room has no seats left — copying it would only disappoint whoever gets it. */
  full?: boolean;
  /** Tighter layout for the chat's room bar. */
  compact?: boolean;
}) {
  const t = useTranslations('guestRoom');

  return (
    <ShareLinkField
      url={guestRoomInviteUrl(code, surface)}
      ariaLabel={t('inviteLink')}
      disabled={full}
      disabledLabel={t('roomFull')}
      compact={compact}
    />
  );
}
