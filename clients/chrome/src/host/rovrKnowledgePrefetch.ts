/**
 * Rovr's knowledge PreFetch (PRD 38 §3.1 "from any host"): THE browser port
 * (`@builderforce/knowledge-browser` `createBrowserKnowledgePrefetchPort` — the same one the
 * web chat runs) for the project Rovr files tasks in, over Rovr's authenticated fetch. A
 * run gets it through `prepareRun` while signed in with a project chosen; its answer chips
 * open the Knowledge tab (`knowledgeChips.ts`).
 */

import { createKnowledgeClient } from '@builderforce/knowledge-client';
import {
  BROWSER_PREFETCH_CALIBRATION_KEY, createBrowserKnowledgePrefetchPort, localStorageCalibration,
} from '@builderforce/knowledge-browser';
import type { BrainRunRequest } from '@seanhogg/builderforce-brain-embedded';
import type { AuthenticatedFetch } from '../api/apiClient';

export type RunPrefetchPort = NonNullable<BrainRunRequest['prefetch']>;

export interface RovrKnowledgePrefetchDeps {
  signedIn(): boolean;
  /** Settings → File new tasks in: the project knowledge is kept for. */
  projectId(): Promise<number | null>;
  fetch: AuthenticatedFetch;
}

/** The run's knowledge port right now (one per project, so its calibration reads stay warm); undefined ⇒ none. */
export function rovrKnowledgePrefetch(deps: RovrKnowledgePrefetchDeps): () => Promise<RunPrefetchPort | undefined> {
  const ports = new Map<number, RunPrefetchPort>();
  return async () => {
    if (!deps.signedIn()) return undefined;
    const projectId = await deps.projectId();
    if (projectId == null) return undefined;
    let port = ports.get(projectId);
    if (!port) {
      port = createBrowserKnowledgePrefetchPort({
        client: createKnowledgeClient({ projectId, fetch: deps.fetch }),
        calibration: localStorageCalibration(BROWSER_PREFETCH_CALIBRATION_KEY),
      });
      ports.set(projectId, port);
    }
    return port;
  };
}
