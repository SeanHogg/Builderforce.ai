import { parentPort } from "node:worker_threads";
import {
  runBuilderForceAgentsLlmLocalRequest,
  type BuilderForceAgentsLlmLocalRunRequest,
} from "./builderforcellm-local-stream.js";

type WorkerRunMessage = {
  type: "run";
  id: string;
  request: BuilderForceAgentsLlmLocalRunRequest;
};

if (!parentPort) {
  throw new Error("Local brain worker started without a parent port");
}

let queue = Promise.resolve();

parentPort.on("message", (message: WorkerRunMessage) => {
  if (!message || message.type !== "run" || !message.id) {
    return;
  }

  queue = queue
    .catch(() => undefined)
    .then(async () => {
      try {
        const finalText = await runBuilderForceAgentsLlmLocalRequest(message.request);
        parentPort?.postMessage({ type: "result", id: message.id, finalText });
      } catch (error) {
        parentPort?.postMessage({
          type: "error",
          id: message.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
});
