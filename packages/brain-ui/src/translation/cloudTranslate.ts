/**
 * The ONE cloud translation client (PRD 42 · E4) every host mounts: `POST /api/translate`
 * through the host's own authenticated request, batched (≤ 20 texts a call, one request per
 * `to`/`from` pair). The route REQUIRES the source language, so a call without one is refused
 * here, before anything leaves the device.
 */
import { createTranslateBatcher } from './batcher';
import type { CloudTranslate } from './context';

export interface CloudTranslateBody { texts: string[]; to: string; from: string }

/** The host's authenticated POST of the body to `/api/translate`; resolves the route's JSON. */
export type CloudTranslateRequest = (body: CloudTranslateBody) => Promise<{ translations: string[] }>;

export function createCloudTranslate(request: CloudTranslateRequest): CloudTranslate {
  const batched = createTranslateBatcher(async (texts, to, from) => {
    const { translations } = await request({ texts, to, from: from! });
    return translations;
  });
  return (texts, to, from) => (from
    ? batched(texts, to, from)
    : Promise.reject(new Error('translate: the source language is required')));
}
