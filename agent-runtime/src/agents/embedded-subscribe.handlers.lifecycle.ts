import { emitAgentEvent } from "../infra/agent-events.js";
import { createInlineCodeState } from "../markdown/code-spans.js";
import { formatAssistantErrorText } from "./embedded-helpers.js";
import type { EmbeddedSubscribeContext } from "./embedded-subscribe.handlers.types.js";
import { isAssistantMessage } from "./embedded-utils.js";

export {
  handleAutoCompactionEnd,
  handleAutoCompactionStart,
} from "./embedded-subscribe.handlers.compaction.js";

export function handleAgentStart(ctx: EmbeddedSubscribeContext) {
  ctx.log.debug(`embedded run agent start: runId=${ctx.params.runId}`);
  emitAgentEvent({
    runId: ctx.params.runId,
    stream: "lifecycle",
    data: {
      phase: "start",
      startedAt: Date.now(),
    },
  });
  void ctx.params.onAgentEvent?.({
    stream: "lifecycle",
    data: { phase: "start" },
  });
}

export function handleAgentEnd(ctx: EmbeddedSubscribeContext) {
  const lastAssistant = ctx.state.lastAssistant;
  const isError = isAssistantMessage(lastAssistant) && lastAssistant.stopReason === "error";
  // A run that ENDED FAILED but said why as an ordinary reply (`runFailed`): the lifecycle ends in the error phase exactly as an errored
  // turn's did, so the consumers that watch for a failed run (a sub-agent's parent, `agent.wait`, the web chat) are told. No classifier
  // runs on its text: it goes out as the error as it was written.
  const failedReply = isAssistantMessage(lastAssistant) && lastAssistant.runFailed === true ? lastAssistant : undefined;

  ctx.log.debug(`embedded run agent end: runId=${ctx.params.runId} isError=${isError}`);

  if (failedReply) {
    const error = failedReply.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim() || "The run failed.";
    // `runFailed` tells the chat the text was already streamed as the run's reply (see `ErrorFinalDetails.replyStreamed`).
    emitAgentEvent({ runId: ctx.params.runId, stream: "lifecycle", data: { phase: "error", error, endedAt: Date.now(), runFailed: true } });
    void ctx.params.onAgentEvent?.({ stream: "lifecycle", data: { phase: "error", error } });
    finishRunLifecycle(ctx);
    return;
  }

  if (isError && lastAssistant) {
    const friendlyError = formatAssistantErrorText(lastAssistant, {
      cfg: ctx.params.config,
      sessionKey: ctx.params.sessionKey,
      provider: lastAssistant.provider,
      model: lastAssistant.model,
    });
    emitAgentEvent({
      runId: ctx.params.runId,
      stream: "lifecycle",
      data: {
        phase: "error",
        error: friendlyError || lastAssistant.errorMessage || "LLM request failed.",
        endedAt: Date.now(),
      },
    });
    void ctx.params.onAgentEvent?.({
      stream: "lifecycle",
      data: {
        phase: "error",
        error: friendlyError || lastAssistant.errorMessage || "LLM request failed.",
      },
    });
  } else {
    emitAgentEvent({
      runId: ctx.params.runId,
      stream: "lifecycle",
      data: {
        phase: "end",
        endedAt: Date.now(),
      },
    });
    void ctx.params.onAgentEvent?.({
      stream: "lifecycle",
      data: { phase: "end" },
    });
  }

  finishRunLifecycle(ctx);
}

/** What closes every run, failed or not: the buffered reply is flushed, the block state reset, and a waiting compaction retry released. */
function finishRunLifecycle(ctx: EmbeddedSubscribeContext) {
  ctx.flushBlockReplyBuffer();

  ctx.state.blockState.thinking = false;
  ctx.state.blockState.final = false;
  ctx.state.blockState.inlineCode = createInlineCodeState();

  if (ctx.state.pendingCompactionRetry > 0) {
    ctx.resolveCompactionRetry();
  } else {
    ctx.maybeResolveCompactionWait();
  }
}
