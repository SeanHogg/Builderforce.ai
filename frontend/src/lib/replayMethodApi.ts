/**
 * The method link's slice of the Insights client (PRD 33 §5.3.4) — spread into
 * `replayApi` like `replayAnalysisApi`, so components keep one client.
 */

import { REPLAY_PATHS, type ReplayTicketEffectDto } from '@builderforce/interaction-contract';
import { apiRequest } from './apiClient';
import { fill } from './replayHttp';

export const replayMethodApi = {
  /** A ticket raised from a replay moment: its measured effect, or null when it was not raised from one. */
  async ticketEffect(taskId: number): Promise<ReplayTicketEffectDto | null> {
    const body = await apiRequest<ReplayTicketEffectDto | { effect: null }>(fill(REPLAY_PATHS.ticketEffect, { taskId }), { expectedErrors: [403, 404] });
    return body && 'status' in body ? body : null;
  },
};
