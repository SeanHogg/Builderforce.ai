/**
 * The run delta's worker entry (bundled to `out/runDeltaWorker.js`, `esbuild.mjs`): ONE engine call per worker, over the
 * prepared data the extension host gathered (`runDeltaPorts.ts`). The host terminates the worker when the delta's budget runs
 * out, so a slow rule never holds the extension host's thread. The delta crosses back in bounded parts (`deltaWorkerProtocol.ts`).
 */

import { parentPort } from "node:worker_threads";
import { isOverBudget, postBounded } from "../workers/boundedTransfer";
import { RUN_DELTA_ARRAYS, RUN_DELTA_OVER_BUDGET, type DeltaWorkerReply } from "./deltaWorkerProtocol";
import { computePrepared, type PreparedDelta } from "./preparedPorts";
import { messageOf } from "../messageOf";

const send = (reply: DeltaWorkerReply): void => parentPort?.postMessage(reply);

parentPort?.once("message", (prepared: PreparedDelta) => {
  computePrepared(prepared).then(
    (delta) => {
      try {
        send({ type: "ok", delta: postBounded(send, delta, RUN_DELTA_ARRAYS) });
      } catch (error) {
        const message = messageOf(error);
        send(isOverBudget(error) ? { type: "error", error: `${RUN_DELTA_OVER_BUDGET}: ${message}`, code: RUN_DELTA_OVER_BUDGET } : { type: "error", error: message });
      }
    },
    (error: unknown) => send({ type: "error", error: messageOf(error) }),
  );
});
