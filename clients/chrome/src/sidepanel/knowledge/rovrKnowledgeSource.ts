/**
 * Rovr's ports into THE shared browser knowledge source (`@builderforce/knowledge-browser`,
 * PRD 38 §4.7 Rovr row) — and nothing else: the knowledge API client over Rovr's
 * authenticated fetch, where a review can read from (the File System Access folder picker,
 * with the folder upload as the fallback), the side-panel review worker `build.mjs` emits,
 * and Rovr's error reporting for a degraded path. The review itself, the manifest, the
 * graph and the labels are the package's — the same code the web runs.
 */

import { createKnowledgeClient } from '@builderforce/knowledge-client';
import {
  canPickDirectory, createKnowledgeSource, fsAccessDirectoryProvider, uploadDirectoryProvider, type DirectoryProvider,
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
}

export function createRovrKnowledgeSource({ projectId, fetch, reportError }: RovrKnowledgeDeps): KnowledgeGraphSource {
  return createKnowledgeSource({
    projectId,
    client: createKnowledgeClient({ projectId, fetch }),
    directorySources: async () => rovrDirectoryProviders(),
    createWorker: rovrReviewWorker,
    onDegraded: (what, error) => reportError(error, `knowledge.${what.replace(/\s+/g, '-')}`),
  });
}
