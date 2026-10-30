/**
 * The panel's `run.steer` message, handed to the host: one message (`text`) or several turns said to a chat's run together
 * (`turns`, each with the `eventKey` that makes a repeated post harmless - `BrainRunDriver.steer`). A text attachment reaches the
 * run as its text, like a normal send; pictures stay vision parts of the steered turn. Queued at once: the texts are only FITTED
 * (synchronously, no compressor or route lookup in front of the steer).
 *
 * No `vscode` import: the caller supplies `withInlined` (the host's attachment ingress).
 */

import type { ChatInputAttachment, SteerTurn } from "@seanhogg/builderforce-brain-embedded";
import type { BrainRunHost } from "./brainRunHostContract";

/** The fields of the inbound message this reads. */
export interface SteerMessage {
  chatId: number;
  text?: string;
  attachments?: ChatInputAttachment[];
  turns?: SteerTurn[];
}

export function steerFromMessage(
  host: Pick<BrainRunHost, "steer" | "steerTurns"> | undefined,
  msg: SteerMessage,
  withInlined: (text: string, files: ChatInputAttachment[] | undefined) => string,
): void {
  const textFiles = (files: ChatInputAttachment[] | undefined) => (Array.isArray(files) ? files : undefined);
  if (Array.isArray(msg.turns)) {
    const turns = msg.turns
      .filter((turn) => turn && typeof turn.text === "string" && typeof turn.eventKey === "string")
      .map((turn) => ({ ...turn, text: withInlined(turn.text, textFiles(turn.attachments)?.filter((a) => !a.imageUrl)) }));
    if (turns.length > 0) host?.steerTurns(msg.chatId, turns);
    return;
  }
  if (typeof msg.text !== "string") return;
  const attachments = textFiles(msg.attachments);
  host?.steer(msg.chatId, withInlined(msg.text, attachments?.filter((a) => !a.imageUrl)), attachments);
}
