/**
 * The editor's gateway transport: the streaming completion fn every run in this extension (the panel's, the native
 * participant's, a sub-agent's) is given by `modelRouting.ts`. It owns no loop - the ONE run is `openRun`'s; this is only the
 * cloud half of the transport choice. Free of any `vscode` import so a test can read the outgoing headers.
 */

import {
  streamChatCompletion,
  withUsageSurface,
  USAGE_SURFACE_HEADER,
  type UsageSurface,
  type BrainStreamFn,
  type BrainTransport,
} from "@seanhogg/builderforce-brain-embedded";
import { observeGatewayResponse } from "../auth/gatewayAuth";

/**
 * The header that tells the gateway WHICH surface spent the tokens, so BYO / free
 * metering attributes an editor turn to the editor. It rides the transport, the
 * only place every surface in this extension can share it.
 */
export const SURFACE_HEADER = USAGE_SURFACE_HEADER;
export const SURFACE_VALUE = "vsix" satisfies UsageSurface;

/**
 * The streaming completion fn for the editor.
 *
 * Error mapping is deliberately the package default: it preserves the gateway's
 * STRUCTURED entitlement fields (402 needs-a-card, 401 expired session), which is what
 * lets the participant offer "Upgrade" / "Add a card" instead of restating a refusal.
 * `fetchImpl` exists so a test can read the outgoing headers; production passes nothing.
 */
export function createNativeStream(
  baseUrl: string,
  apiKey: string,
  fetchImpl: (input: string, init: RequestInit) => Promise<Response> = (input, init) => fetch(input, init),
  /** Extra request headers read PER REQUEST (the selected workspace); injected so this
   *  module stays free of editor session state. */
  extraHeaders: () => Record<string, string> | Promise<Record<string, string>> = () => ({}),
): BrainStreamFn {
  const withExtra = async (input: string, init: RequestInit) => {
    const headers = { ...((init.headers as Record<string, string> | undefined) ?? {}), ...(await extraHeaders()) };
    return observeGatewayResponse(await fetchImpl(input, { ...init, headers }), headers);
  };
  const transport: BrainTransport = {
    baseUrl,
    getToken: () => apiKey,
    fetch: withUsageSurface(withExtra, SURFACE_VALUE),
  };
  return (opts, handlers) => streamChatCompletion({ ...opts, transport }, handlers);
}
