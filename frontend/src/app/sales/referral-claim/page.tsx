'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { salesApi } from '@/lib/salesApi';
import { safeRedirectPath } from '@/lib/safeRedirect';

/** OAuth returns here with a verified web session so referral attribution cannot
 * be lost when a prospect chooses Google/GitHub/LinkedIn/Microsoft signup. */
export default function ReferralClaimPage() {
  const router = useRouter();
  const params = useSearchParams();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const claim = useCallback(async () => {
    const code = params.get('ref')?.trim();
    const next = safeRedirectPath(params.get('next'));
    if (!code) { router.replace(next); return; }
    setError(null);
    try {
      await salesApi.claimReferral(code);
      router.replace(next);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not record referral attribution.'); }
  }, [params, router]);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void claim();
  }, [claim]);
  return <main style={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}><div style={{ textAlign: 'center' }}><p>{error || 'Finishing account setup…'}</p>{error && <button type="button" onClick={() => void claim()}>Retry</button>}</div></main>;
}
