/**
 * A start the store refuses - a run is going, or a continuation holds the chat (`runClaim.ts`) - must
 * not drop the turn it carried. The caller has already saved the person's row and cleared their
 * composer; if nothing reads the words they vanish. So they go into the live run's inbox, which it
 * reads at its next call (interrupting the step in flight), exactly once.
 */

import { recordedModelText } from '../attachmentTranscript';
import { queueRunSteering } from '../runSteering';
import type { ChatInputAttachment } from '../types';
import type { BrainRunRequest } from './runTypes';

/** What `startRun` resolves to: the run ran to its end, or its turn joined the run that already holds the chat. */
export type StartOutcome = 'ran' | 'joined';

export function handTurnToLiveRun(runKey: number, request: BrainRunRequest): void {
  const turn = request.userTurn;
  if (turn === undefined) return;
  // Pictures ride as attachments (the inbox renders them as vision parts); everything else is already in the text.
  const pictures: ChatInputAttachment[] = typeof turn === 'string'
    ? []
    : turn.flatMap((p) => (p.type === 'image_url' ? [{ key: p.image_url.url, name: 'image', type: 'image', imageUrl: p.image_url.url }] : []));
  queueRunSteering(runKey, recordedModelText(turn), {
    interrupt: true,
    fromPerson: true,
    // A row exists (the send saved it): it is shown already. Without one, the run saves it as it reads it.
    ...(request.userTurnMessageId != null ? { saved: true } : { persist: true }),
    ...(pictures.length > 0 ? { attachments: pictures } : {}),
  });
}
