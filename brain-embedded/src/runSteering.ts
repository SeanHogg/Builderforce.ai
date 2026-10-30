/**
 * The Brain's face of the run steering queue (PRD 35 §6.3).
 *
 * The queue itself — keyed by RUN KEY, with its interrupt flag and listeners — lives ONCE, in
 * `@builderforce/agent-run` (`policy/steering/runSteering.ts`): the agent's steering policy
 * and every surface that drains the queue read the same inboxes. What stays here is the
 * Brain's own: the attachment type its composer produces, and the rendering of a steered
 * message into the vision parts a model request carries (`steerModelContent`).
 *
 * Direction for a run that is ALREADY running — redirecting it without stopping it — is
 * how an owner corrects a sub-agent mid-task and how a child's report reaches a parent that
 * is still working. The loop drains the queue before every model turn and, when the model
 * was about to end, re-opens the run for what arrived (`brainRunStore.ts`). A message
 * queued for a run that is not running waits for its next turn — the host decides whether
 * to start one.
 */

import {
  drainRunSteering as drainQueue,
  hasRunInterrupt,
  newSteerKey,
  onRunInterrupt,
  queueRunSteering as queueMessage,
  requeueRunSteering as requeueMessages,
  resetRunSteering,
  type RunSteerMessage as QueuedSteerMessage,
} from '@builderforce/agent-run';
import { rememberPendingWords } from './pendingWords';
import type { ContentPart } from './streamChatCompletion';
import type { ChatInputAttachment } from './types';

/**
 * A queued direction for a run. Carries its attachments so a message steered
 * mid-run reaches the model with the same vision parts a normal send builds —
 * a bare string here is what dropped mid-run images.
 */
export interface RunSteerMessage extends Omit<QueuedSteerMessage, 'attachments'> {
  attachments?: ChatInputAttachment[];
}

/**
 * Queue one message for a run's next turn. Blank text is ignored. `interrupt` also
 * aborts the run's interruptible step now (a foreground command) and skips the rest of
 * its turn's calls. Attachments ride along so mid-run messages keep their images;
 * `persist` asks the run to save and show the message when it drains it; `saved` says a row for
 * it already exists (so nothing saves it again).
 */
export function queueRunSteering(
  runKey: number,
  text: string,
  opts?: { interrupt?: boolean; attachments?: ChatInputAttachment[]; fromPerson?: boolean; persist?: boolean; saved?: boolean; eventKey?: string },
): void {
  // The queue keys the words the run will save (`persist`) as it takes them in; a requeue passes the key it already has.
  // (A steer with no key - an owner's, a child's - is keyed by the continuation before its first save attempt.)
  const queued = queueMessage(runKey, text, opts);
  // Words the run will save are also written to the device's journal - AFTER they are in the inbox, so a storage
  // failure can never cost a steer: a reload before they are saved still finds them, which is what makes "your
  // message is kept" true.
  if (queued?.persist && queued.eventKey) rememberPendingWords(runKey, queued.eventKey, queued.text);
}

/** Put steers a continuation could not act on back at the FRONT of the run's inbox, in order, each with its own flags and key. */
export function requeueRunSteering(runKey: number, steers: readonly RunSteerMessage[]): void {
  requeueMessages(runKey, steers);
}

export { newSteerKey };

/** Take every message queued for a run, oldest first. Empty when none are waiting. */
export function drainRunSteering(runKey: number): RunSteerMessage[] {
  return drainQueue(runKey) as RunSteerMessage[];
}

/**
 * Model-visible content for one steered message: inline images as `image_url` vision
 * parts (the same shape a normal send builds in `useBrainConversation.send`), so a
 * steered message reaches the model identically whether it arrived mid-run or not.
 * Without an image it stays a plain string.
 */
export function steerModelContent(msg: RunSteerMessage): string | ContentPart[] {
  const imageAtts = (msg.attachments ?? []).filter((a) => a.imageUrl);
  if (imageAtts.length === 0) return msg.text;
  return [
    { type: 'text', text: msg.text },
    ...imageAtts.map((a) => ({ type: 'image_url' as const, image_url: { url: a.imageUrl! } })),
  ];
}

export { hasRunInterrupt, onRunInterrupt, resetRunSteering };
