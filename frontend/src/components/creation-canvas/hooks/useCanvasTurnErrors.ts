import { useCallback, useState } from 'react';
import type { useTranslations } from 'next-intl';
import { trackActivity } from '@/lib/activity/tracker';
import { canvasSurface } from '@/lib/canvasHost';
import { GuestAiUnavailableError } from '@/lib/canvasAiErrors';
import { guestLimitRefusal, type GuestLimitRefusal } from '@/lib/guestLimit';

export interface UseCanvasTurnErrorsDeps {
  sessionId: string;
  t: ReturnType<typeof useTranslations<'creationCanvas'>>;
}

/** How a failed AI turn is put into words, and the guest wall it may have run into. */
export function useCanvasTurnErrors({ sessionId, t }: UseCanvasTurnErrorsDeps) {
  /**
   * The guest wall this board has run into, or null while it has not. Set from the
   * refused turn itself and cleared by the next turn that succeeds, so the CTA is
   * exactly as live as the block it answers — a visitor who signs up in another
   * tab and comes back to a working canvas is not still being sold an account.
   */
  const [guestLimit, setGuestLimit] = useState<GuestLimitRefusal | null>(null);
  /**
   * The one place a failed AI turn becomes words. Known failures the visitor can
   * act on are said in their own language; anything else keeps the underlying
   * message, which is what makes a real error debuggable. Every turn site routes
   * through here so the guest path can never regress to a raw English throw.
   */
  const describeTurnError = useCallback((error: unknown, fallbackKey: 'noticeBrainFailed' | 'noticeAgentTestFailed' | 'noticeAgentGroupFailed') => {
    if (error instanceof GuestAiUnavailableError) return t('noticeGuestAiUnavailable');
    // A guest who has spent their free turns: the gateway sends `guest_limit_reached`
    // with the cap on the body (GUEST_CHAT_LIMITS), and its own English prose. Say it
    // in the visitor's language, and ARM the conversion CTA in the same step — the
    // sentence alone told a blocked visitor to sign up while offering nothing to
    // click. Every turn site routes through here, so no path can say the words and
    // forget the button.
    const refusal = guestLimitRefusal(error);
    if (refusal) {
      setGuestLimit(refusal);
      // Same event the account-gate modal files, so conversion is counted once
      // wherever the visitor met the wall.
      trackActivity('creation_account_gate_shown', { sessionId, metadata: { clientSurface: canvasSurface(), action: 'guest_limit' } });
      if (refusal.reason === 'ip') return t('noticeGuestLimitDevice');
      if (refusal.reason === 'room') return t('noticeGuestLimitRoom', { limit: refusal.limit ?? 0 });
      return t('noticeGuestLimitReached', { limit: refusal.limit ?? 0 });
    }
    return error instanceof Error && error.message ? error.message : t(fallbackKey);
  }, [sessionId, t]);
  return { guestLimit, setGuestLimit, describeTurnError };
}
