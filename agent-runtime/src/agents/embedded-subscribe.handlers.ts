import {
  handleAgentEnd,
  handleAgentStart,
  handleAutoCompactionEnd,
  handleAutoCompactionStart,
} from "./embedded-subscribe.handlers.lifecycle.js";
import {
  handleMessageEnd,
  handleMessageStart,
  handleMessageUpdate,
} from "./embedded-subscribe.handlers.messages.js";
import {
  handleToolExecutionEnd,
  handleToolExecutionStart,
  handleToolExecutionUpdate,
} from "./embedded-subscribe.handlers.tools.js";
import type {
  EmbeddedSubscribeContext,
  EmbeddedSubscribeEvent,
} from "./embedded-subscribe.handlers.types.js";

export function createEmbeddedSessionEventHandler(ctx: EmbeddedSubscribeContext) {
  return (evt: EmbeddedSubscribeEvent) => {
    switch (evt.type) {
      case "message_start":
        handleMessageStart(ctx, evt as never);
        return;
      case "message_update":
        handleMessageUpdate(ctx, evt as never);
        return;
      case "message_end":
        handleMessageEnd(ctx, evt as never);
        return;
      case "tool_execution_start":
        // Async handler - best-effort typing indicator, avoids blocking tool summaries.
        // Catch rejections to avoid unhandled promise rejection crashes.
        handleToolExecutionStart(ctx, evt as never).catch((err) => {
          ctx.log.debug(`tool_execution_start handler failed: ${String(err)}`);
        });
        return;
      case "tool_execution_update":
        handleToolExecutionUpdate(ctx, evt as never);
        return;
      case "tool_execution_end":
        // Async handler - best-effort, non-blocking
        handleToolExecutionEnd(ctx, evt as never).catch((err) => {
          ctx.log.debug(`tool_execution_end handler failed: ${String(err)}`);
        });
        return;
      case "agent_start":
        handleAgentStart(ctx);
        return;
      case "auto_compaction_start":
        handleAutoCompactionStart(ctx);
        return;
      case "auto_compaction_end":
        handleAutoCompactionEnd(ctx, evt as never);
        return;
      case "agent_end":
        handleAgentEnd(ctx);
        return;
      default:
        return;
    }
  };
}
