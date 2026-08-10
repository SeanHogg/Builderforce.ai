'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/AuthContext';
import { claimPendingDrafts, type ClaimedDraft } from '@/lib/pendingWork';
import { AppToast, AppToastDismissButton, AppToastPrimaryButton, AppToastText } from '@/components/AppToast';
import { useAppToastSlot } from '@/components/appToastStack';

/**
 * Signing in resumes the work instead of resetting it.
 *
 * An account-less canvas is real work held in this browser, and the only moment
 * it can be made durable is the moment a tenant exists. That hand-off used to
 * live in one `useEffect` on `/create/[sessionId]`, so it only fired if the
 * browser happened to land back on that exact route — and every hop that drops
 * `?next=` (an OAuth round trip, the workspace picker, verifying email in a
 * second tab) lands on `/dashboard` instead, where nothing ever looked for a
 * draft. That is the measured cause of "I signed up and lost what I was making".
 *
 * This bridge is mounted app-wide and driven by the local-draft INDEX rather
 * than by the URL, so the URL stops being load-bearing. It decides its own
 * visibility: nothing renders unless a claim actually rescued something the user
 * is not already looking at.
 *
 * Claiming itself is `lib/pendingWork`, shared with the route and coalesced per
 * session id — so the two callers can never double-claim the same board.
 */
export function ResumeWorkBridge() {
  const t = useTranslations('resumeWork');
  const router = useRouter();
  const pathname = usePathname() || '';
  const { isAuthenticated, hasTenant } = useAuth();
  const ran = useRef(false);
  const [claimed, setClaimed] = useState<ClaimedDraft[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !hasTenant || ran.current) return;
    ran.current = true;
    void claimPendingDrafts().then((result) => setClaimed(result.claimed));
  }, [isAuthenticated, hasTenant]);

  const newest = claimed[0];
  // The route already redirects a visitor who is standing on the board being
  // claimed — telling them about it as well would be noise.
  const alreadyThere = !!newest && pathname.startsWith(`/create/${newest.sessionId}`);
  const visible = !!newest && !dismissed && !alreadyThere;
  const slot = useAppToastSlot('resume', visible);

  const open = useCallback(() => {
    if (!newest) return;
    setDismissed(true);
    router.push(`/create/${newest.sessionId}`);
  }, [newest, router]);

  if (!visible || !newest) return null;

  return (
    <AppToast slot={slot}>
      <AppToastText>
        {claimed.length > 1
          ? t('savedMany', { title: newest.title, count: claimed.length - 1 })
          : t('savedOne', { title: newest.title })}
      </AppToastText>
      <AppToastPrimaryButton onClick={open}>{t('open')}</AppToastPrimaryButton>
      <AppToastDismissButton onClick={() => setDismissed(true)} />
    </AppToast>
  );
}
