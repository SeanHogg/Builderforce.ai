/**
 * Per-REQUEST credential-lookup state for a local transport — one concern, split out of
 * `localFirstTransport.ts`.
 *
 * Whether each request's credential lookup (`endpoint.credential`) settled: a lookup that
 * never returns is the other way a hosted call can sit silent, and the failure detail says
 * which half it was. Keyed by the request's abort signal because one transport serves
 * concurrent calls and a shared flag would report another call's state.
 */

import type { LocalEndpoint } from '@builderforce/local-inference';

export type CredentialState = 'resolved' | 'pending' | 'none';

export interface CredentialTracker {
  /** The state of the request riding on `signal` (`none` for an untracked request). */
  stateOf(signal: AbortSignal | null | undefined): CredentialState;
  /** The endpoint one request uses, its credential lookup marking the request's state. */
  track(endpoint: LocalEndpoint, signal: AbortSignal | undefined): LocalEndpoint;
}

export function createCredentialTracker(): CredentialTracker {
  const states = new WeakMap<AbortSignal, CredentialState>();
  return {
    stateOf: (signal) => (signal ? states.get(signal) : undefined) ?? 'none',
    track: (endpoint, signal) => {
      const mark = (state: CredentialState): void => { if (signal) states.set(signal, state); };
      mark(endpoint.credential ? 'pending' : 'none');
      if (!endpoint.credential) return endpoint;
      const lookup = endpoint.credential;
      return {
        ...endpoint,
        credential: async (stale) => {
          mark('pending');
          try { return await lookup(stale); } finally { mark('resolved'); }
        },
      };
    },
  };
}
