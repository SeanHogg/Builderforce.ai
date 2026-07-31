'use client';

import { useEffect, useState } from 'react';
import { getStoredUser } from './auth';
import { getMarketingSession, convertVisitor, type MarketingSessionView } from './marketingApi';

const CONVERTED_FLAG = 'bf_visitor_converted';

/**
 * Returning-visitor state for the free Diagnostics & Tools suite.
 *
 * - When LOGGED OUT: loads the anonymous marketing session (their previously-run
 *   diagnostics) so the UI can say "welcome back — here are your results" and
 *   nudge a sign-up.
 * - When LOGGED IN: fires a one-time conversion so the anonymous session is
 *   attributed to the new account, then reports no returning-visitor state.
 *
 * Shared by the tools hub and the tool runner so the returning-visitor logic
 * lives in exactly one place (the consumers just render the data).
 */
export function useMarketingVisitor(): { session: MarketingSessionView | null; loading: boolean; isAuthed: boolean } {
  const [session, setSession] = useState<MarketingSessionView | null>(null);
  const [loading, setLoading] = useState(true);
  const isAuthed = !!getStoredUser();

  useEffect(() => {
    let alive = true;

    if (isAuthed) {
      // Close the funnel once per browser (attribution), then stop tracking.
      try {
        if (!window.localStorage.getItem(CONVERTED_FLAG)) {
          convertVisitor();
          window.localStorage.setItem(CONVERTED_FLAG, '1');
        }
      } catch { /* ignore */ }
      setLoading(false);
      return () => { alive = false; };
    }

    getMarketingSession()
      .then((s) => { if (alive) setSession(s); })
      .finally(() => { if (alive) setLoading(false); });

    return () => { alive = false; };
  }, [isAuthed]);

  return { session, loading, isAuthed };
}
