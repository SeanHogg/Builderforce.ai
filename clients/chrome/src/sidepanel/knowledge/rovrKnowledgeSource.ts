/**
 * Rovr's ports into THE shared browser knowledge source (`@builderforce/knowledge-browser`,
 * PRD 38 §4.7 Rovr row) — and nothing else: the knowledge API client over Rovr's
 * authenticated fetch, where a review can read from (the File System Access folder picker,
 * with the folder upload as the fallback), the side-panel review worker `build.mjs` emits,
 * and Rovr's error reporting for a degraded path. The review itself, the manifest, the
 * graph and the labels are the package's — the same code the web runs.
 */

import { gatewayErrorMessage, pinpointVisionRequest } from '@builderforce/agent-tools/knowledge';
import { judgeClientFirstFor, type ClientFirstHost } from '@seanhogg/builderforce-brain-embedded';
import { createKnowledgeClient } from '@builderforce/knowledge-client';
import {
  canPickDirectory, createKnowledgeSource, fsAccessDirectoryProvider, uploadDirectoryProvider, type DirectoryProvider, type PinpointHost,
} from '@builderforce/knowledge-browser';
import type { KnowledgeGraphSource } from '@builderforce/knowledge-graph-view';
import type { AuthenticatedFetch } from '../../api/apiClient';
import { KNOWLEDGE_WORKER_FILE } from '../../config';

/** Rovr's root-id prefix (`rovr:folder:<name>`, `rovr:upload:<name>`). */
export const ROVR_HOST = 'rovr';

/** "Review a folder" → the folder picker where the browser has one; the upload always. */
export function rovrDirectoryProviders(): DirectoryProvider[] {
  return [...(canPickDirectory() ? [fsAccessDirectoryProvider(ROVR_HOST)] : []), uploadDirectoryProvider(ROVR_HOST)];
}

/** The review worker, by its extension URL; null (the review runs in-thread) when it cannot start. */
export function rovrReviewWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    return new Worker(chrome.runtime.getURL(KNOWLEDGE_WORKER_FILE), { type: 'module', name: 'knowledge-review' });
  } catch {
    return null;
  }
}

export interface RovrKnowledgeDeps {
  projectId: number;
  fetch: AuthenticatedFetch;
  reportError(error: unknown, operation: string): void;
  /** The panel's on-device port (`pageClientFirst(services.onDeviceTasks)`); absent ⇒ judged on the server. */
  clientFirst?: ClientFirstHost;
}

/**
 * Pinpoint's vision call over Rovr's authenticated fetch: THE shared vision request (no
 * pinned model; the gateway routes to a vision-capable one, or answers
 * `model_input_unsupported`, shown to the person via the shared error parser). No `catalogKeys`: the i18n catalogs
 * belong to the web app's bundle, Rovr ships none to look a screen string up in, so
 * Rovr matches by the literal scan of the folder it reviewed (and imports).
 */
export function rovrPinpointHost(fetch: AuthenticatedFetch): PinpointHost {
  return {
    async describe(imageDataUrl) {
      const res = await fetch('/llm/v1/chat/completions', { method: 'POST', json: pinpointVisionRequest(imageDataUrl) });
      if (!res.ok) throw new Error(gatewayErrorMessage(await res.json().catch(() => ({})), `gateway ${res.status}`));
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return data.choices?.[0]?.message?.content ?? '';
    },
  };
}

export function createRovrKnowledgeSource({ projectId, fetch, reportError, clientFirst }: RovrKnowledgeDeps): KnowledgeGraphSource {
  // The device judges first when the panel lends its port (PRD 42 · D2); else the server path.
  const client = createKnowledgeClient({
    projectId, fetch, ...(clientFirst ? { judgeClientFirst: judgeClientFirstFor(clientFirst) } : {}),
  });
  return createKnowledgeSource({
    projectId,
    client,
    callPrice: () => client.judgeEstimate(),
    directorySources: async () => rovrDirectoryProviders(),
    pinpoint: rovrPinpointHost(fetch),
    createWorker: rovrReviewWorker,
    onDegraded: (what, error) => reportError(error, `knowledge.${what.replace(/\s+/g, '-')}`),
  });
}
