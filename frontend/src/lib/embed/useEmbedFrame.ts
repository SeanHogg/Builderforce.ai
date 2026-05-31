'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BFEMBED_SOURCE,
  isHostToFrameMessage,
  type EmbedTheme,
  type FrameToHostMessage,
} from '@seanhogg/builderforce-embedded';
import { setEmbedAuth } from '../auth';

/**
 * The iframe (BuilderForce) half of the embed protocol — the mirror of
 * <BuilderForceEmbed> in @seanhogg/builderforce-embedded. The protocol itself is
 * imported from that package so the two ends can never drift.
 *
 * Lifecycle: announce `ready` → receive `auth` (token + segment coords + theme)
 * from the trusted host origin → auto-report content height → expose `navigate`
 * for surfaces to emit deep links back to the host.
 *
 * The token arrives over postMessage (never a cookie/URL), which is what makes
 * cross-origin embedding work without third-party-cookie reliance.
 */

export interface EmbedFrameState {
  /** SSO/tenant JWT handed over by the host; null until auth arrives. */
  token: string | null;
  accountId?: string;
  companyId?: string;
  theme: EmbedTheme;
  /** True once auth has been received. */
  ready: boolean;
  /** Emit a deep-link to the host (host mirrors it into its own URL). */
  navigate: (path: string) => void;
  /** Surface an error to the host. */
  reportError: (message: string) => void;
}

function allowedHostOrigins(): string[] {
  // Same single env var that drives the /embed frame-ancestors CSP (middleware).
  return (process.env.NEXT_PUBLIC_EMBED_ALLOWED_HOST_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function useEmbedFrame(): EmbedFrameState {
  const [state, setState] = useState<Omit<EmbedFrameState, 'navigate' | 'reportError'>>({
    token: null,
    theme: 'light',
    ready: false,
  });
  const hostOriginRef = useRef<string | null>(null);

  const postToHost = useCallback((msg: FrameToHostMessage) => {
    // Before auth we don't yet know the host origin, so the contentless `ready`
    // ping uses '*'; everything after targets the origin that authed us.
    window.parent?.postMessage(msg, hostOriginRef.current ?? '*');
  }, []);

  const navigate = useCallback(
    (path: string) => postToHost({ source: BFEMBED_SOURCE, type: 'navigate', path }),
    [postToHost],
  );
  const reportError = useCallback(
    (message: string) => postToHost({ source: BFEMBED_SOURCE, type: 'error', message }),
    [postToHost],
  );

  // Inbound host → frame messages + the initial ready handshake.
  useEffect(() => {
    const allow = allowedHostOrigins();
    const onMessage = (event: MessageEvent) => {
      if (allow.length > 0 && !allow.includes(event.origin)) return; // trust boundary
      const msg = event.data;
      if (!isHostToFrameMessage(msg)) return;
      if (msg.type === 'auth') {
        hostOriginRef.current = event.origin;
        // Bridge the host-handed token into the app's auth path so every API
        // call (and any resurfaced app component) authenticates unchanged.
        setEmbedAuth(msg.token);
        setState({
          token: msg.token,
          accountId: msg.accountId,
          companyId: msg.companyId,
          theme: msg.theme ?? 'light',
          ready: true,
        });
      } else if (msg.type === 'navigate') {
        // Host → frame deep link; surfaces subscribe to this event.
        window.dispatchEvent(new CustomEvent('bfembed:navigate', { detail: msg.path }));
      }
    };
    // If the app's auth path hit a 401, the token is stale — tell the host.
    const onUnauthorized = () => {
      setState((s) => ({ ...s, token: null, ready: false }));
      reportError('Embed session expired — host must re-auth');
    };
    window.addEventListener('message', onMessage);
    window.addEventListener('bfembed:unauthorized', onUnauthorized);
    postToHost({ source: BFEMBED_SOURCE, type: 'ready' });
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('bfembed:unauthorized', onUnauthorized);
      setEmbedAuth(null); // exit embed mode when the frame unmounts
    };
  }, [postToHost, reportError]);

  // Auto-report content height so the host can size the iframe to fit.
  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const report = () =>
      postToHost({
        source: BFEMBED_SOURCE,
        type: 'resize',
        height: document.documentElement.scrollHeight,
      });
    const ro = new ResizeObserver(report);
    ro.observe(document.documentElement);
    report();
    return () => ro.disconnect();
  }, [postToHost]);

  return { ...state, navigate, reportError };
}
