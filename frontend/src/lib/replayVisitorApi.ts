/**
 * The visitor slice of the Insights client (PRD 33 §1.7 "deleting a visitor deletes
 * their recordings", D17) — spread into `replayApi` like `replayMethodApi`, so
 * components keep one client.
 */

import { REPLAY_PATHS, type ReplayVisitorErasureDto } from '@builderforce/interaction-contract';
import { apiRequest } from './apiClient';
import { fill, withQuery } from './replayHttp';

export const replayVisitorApi = {
  /** Erase one visitor's kept recordings from this site (MANAGER): rows, AI summaries and bytes. */
  eraseVisitor(siteId: string, visitorId: string): Promise<ReplayVisitorErasureDto> {
    return apiRequest(withQuery(fill(REPLAY_PATHS.visitor, { visitorId }), siteId), { method: 'DELETE' });
  },
};
