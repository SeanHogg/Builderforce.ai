/**
 * The metadata of a steered row: mid-turn (so the Evermind learn gate never trains on it, and the reply it prompts
 * stays the turn's answer - a reopened chat's auto-reply does not run it again), plus the attachments the message
 * carried. A leaf on purpose: the run's save (`runStore/steerPersistence.ts`) and the device journal's replay
 * (`pendingWords.ts`) both write a steered row and must write the SAME one.
 */

import { MID_TURN_META_KEY } from '@builderforce/agent-loop';

export function steerMetadata(steer: { attachments?: readonly unknown[] }): string {
  const attachments = steer.attachments ?? [];
  return JSON.stringify({ [MID_TURN_META_KEY]: true, ...(attachments.length > 0 ? { attachments } : {}) });
}
