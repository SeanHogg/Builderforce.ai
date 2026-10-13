'use client';

/**
 * builderforce.ai records itself with the same public snippet every customer
 * pastes (PRD 33 S3, D17 — customer #1). Mounted once in the root layout beside
 * `VisitorJourneyTracker`; renders the loader tag only when a site key is
 * configured AND `replayLoaderMayRecord` allows it (analytics consent, the
 * signed-in gate), then hands the recorder the consent it waited for and, for
 * a signed-in member it may record, who they are.
 */
import { useEffect } from 'react';
import { replayLoaderUrl } from '@builderforce/interaction-contract';
import { useOptionalAuth } from '@/lib/AuthContext';
import { useAnalyticsConsent } from '@/lib/analyticsConsent';
import { useConsumption } from '@/lib/useConsumption';
import { REPLAY_RECORD_SIGNED_IN, replayLoaderMayRecord } from '@/lib/replayLoaderGate';

interface BFReplayApi {
  consent: (granted: boolean) => void;
  identify: (id: string, traits?: Record<string, string>) => void;
  stop?: () => void;
}

function replayGlobal(): BFReplayApi | undefined {
  return (window as Window & { BFReplay?: BFReplayApi }).BFReplay;
}

/** Run `fn` with the recorder's API now, or when the loader script has loaded. */
function whenReplayReady(src: string, fn: (api: BFReplayApi) => void): () => void {
  const ready = replayGlobal();
  if (ready) { fn(ready); return () => undefined; }
  const onLoad = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLScriptElement) || target.src !== src) return;
    const api = replayGlobal();
    if (api) fn(api);
  };
  // `load` does not bubble; capture sees the script's own event.
  document.addEventListener('load', onLoad, true);
  return () => document.removeEventListener('load', onLoad, true);
}

export function ReplayLoader({
  siteKey = process.env.NEXT_PUBLIC_REPLAY_SITE_KEY,
  release = process.env.NEXT_PUBLIC_APP_VERSION,
  recordSignedIn = REPLAY_RECORD_SIGNED_IN,
  cdnOrigin,
}: {
  siteKey?: string;
  release?: string;
  recordSignedIn?: boolean;
  /** Loader origin; defaults to the public CDN (D5). */
  cdnOrigin?: string;
}) {
  const auth = useOptionalAuth();
  const consent = useAnalyticsConsent();
  const consumption = useConsumption();
  const plan = consumption?.plan.effective ?? null;
  const signedIn = !!auth?.isAuthenticated;
  const tenant = auth?.tenant ?? null;
  // The workspace's exclusion rides the consumption snapshot; unknown until it loads.
  const excluded = typeof consumption?.replayExcluded === 'boolean' ? consumption.replayExcluded : null;
  const record = replayLoaderMayRecord({
    siteKey,
    consent,
    authReady: auth?.authReady ?? true,
    signedIn,
    recordSignedIn,
    workspaceExcluded: excluded,
  });
  const src = replayLoaderUrl(cdnOrigin);
  const userId = auth?.user?.id ?? null;

  useEffect(() => {
    if (!siteKey) return undefined;
    if (!record) {
      // Signed in mid-visit (or consent withdrawn): stop a recorder already running.
      replayGlobal()?.stop?.();
      return undefined;
    }
    return whenReplayReady(src, (api) => {
      api.consent(true);
      if (signedIn && userId) {
        api.identify(String(userId), {
          ...(plan ? { plan } : {}),
          ...(tenant ? { workspace: String(tenant.id) } : {}),
        });
      }
    });
  }, [siteKey, record, src, signedIn, userId, plan, tenant]);

  if (!siteKey || !record) return null;
  return <script async src={src} data-site={siteKey} {...(release ? { 'data-release': release } : {})} />;
}
