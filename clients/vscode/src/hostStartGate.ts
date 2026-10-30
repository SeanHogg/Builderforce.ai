/**
 * A Stop that lands while a start is still on its way to the host. The editor's start does
 * work BEFORE the host claims the chat (the change-set baseline is a git capture), and the
 * host drops a Stop for a chat it has not claimed — so a Stop in that window was lost and
 * the run started anyway. The gate holds such a Stop and hands it over the moment the host
 * has claimed the key, where it stops the run before its loop starts (`runSteer.ts`).
 *
 * No `vscode` import: tested directly (`hostStartGate.test.ts`).
 */

import { stopIntent } from "@builderforce/run-guards";
import type { BrainRunHost } from "./brainRunHostContract";

type Gated = Pick<BrainRunHost, "start" | "stop" | "steer" | "steerTurns">;
type StartPayload = Parameters<BrainRunHost["start"]>[0];

/**
 * `host` with its start routed through `around` (which must call `start` exactly once) and
 * a Stop asked meanwhile — the button or a typed stop — delivered once the host has the key.
 */
export function gateStarts(host: Gated, around: (payload: StartPayload, start: () => Promise<void>) => Promise<void>): Gated {
  /** Chats whose start has not reached the host yet. */
  const starting = new Set<number>();
  /** Of those, the ones a Stop was asked for. */
  const stopAsked = new Set<number>();
  const hold = (key: number): void => {
    if (starting.has(key)) stopAsked.add(key);
  };
  return {
    start(payload) {
      const key = payload.chatId;
      starting.add(key);
      return around(payload, () => {
        starting.delete(key);
        // `host.start` claims the key before its first await, so the Stop is heard now.
        const started = host.start(payload);
        if (stopAsked.delete(key)) host.stop(key);
        return started;
      });
    },
    stop(key) {
      hold(key);
      host.stop(key);
    },
    steer(key, text, attachments) {
      if (stopIntent(text)) hold(key);
      host.steer(key, text, attachments);
    },
    steerTurns(key, turns) {
      if (turns.some((turn) => stopIntent(turn.text))) hold(key);
      host.steerTurns(key, turns);
    },
  };
}
