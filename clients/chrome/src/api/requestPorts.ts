/**
 * The shared packages' request PORTS over Rovr's one API client. brain-embedded's memory
 * hooks and brain-ui's chat-ticket adapter both speak `fetch`-shaped `{ method, body }`
 * with a pre-serialized JSON body; Rovr's client takes the value (`json`) so it owns the
 * content type, the credential and the honest error. One bridge, so neither caller grows
 * its own copy of it.
 */
import type { ApiClient } from './apiClient';

export interface PortInit {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit | null;
}

/** An authenticated JSON call in the shared packages' shape, through `api.request`. */
export function portRequest(api: ApiClient): <T>(path: string, init?: PortInit) => Promise<T> {
  return <T>(path: string, init?: PortInit) => {
    const { method, body } = init ?? {};
    const json = typeof body === 'string' && body !== '' ? (JSON.parse(body) as unknown) : undefined;
    return api.request<T>(path, { ...(method ? { method } : {}), ...(json !== undefined ? { json } : {}) });
  };
}
