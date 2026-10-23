import { useEffect } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { setMarketplaceToken } from '@/lib/builderforceApi';

/**
 * Bridge the signed-in web session to the marketplace publisher credential, so a
 * signed-in person can publish without a separate "publisher account" login.
 *
 * The marketplace transport carries its own token (see `mpRequest`); every surface that
 * publishes — the marketplace page and a workspace skill's "Publish" — needs the same
 * bridge, so it is one hook rather than an effect copied into each. Returns whether a
 * session exists to publish as.
 */
export function useMarketplacePublisherToken(): boolean {
  const { webToken } = useAuth();
  useEffect(() => {
    if (webToken) setMarketplaceToken(webToken);
  }, [webToken]);
  return Boolean(webToken);
}
