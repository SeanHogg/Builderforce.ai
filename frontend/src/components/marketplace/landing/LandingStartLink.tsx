import { ButtonLink } from '@/components/ui';
import { useOptionalAuth } from '@/lib/AuthContext';
import { registerHref } from '@/lib/auth';
import type { LandingStart } from '@/lib/marketplace/listingLandings';

/**
 * The landing's "Start free". Signed out → sign-up carrying the intent
 * (`resumeIntent` brings the buyer back to the set-up page); signed in → the
 * set-up page directly.
 */
export function startHref(start: LandingStart, signedIn: boolean): string {
  return signedIn ? start.path : registerHref(start.path, start.intent);
}

export function LandingStartLink({ start, label }: { start: LandingStart; label: string }) {
  const signedIn = !!useOptionalAuth()?.isAuthenticated;
  return (
    <ButtonLink href={startHref(start, signedIn)} variant="primary" size="lg" data-testid="landing-start">
      {label}
    </ButtonLink>
  );
}
