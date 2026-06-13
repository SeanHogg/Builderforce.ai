/**
 * ask_human — the agent's human-in-the-loop "bubble up" tool.
 *
 * Lets the model pause and escalate to a person when it must not (or cannot)
 * proceed alone: request approval for a high-risk action, ask a clarifying
 * question it needs answered, or request feedback/review. The call BLOCKS until
 * a human resolves it in the Builderforce portal (Workforce → Approvals & Q&A)
 * or it times out, then returns the decision / answer to the model.
 *
 * Backed by the shared {@link approvalGate}; in standalone mode (no Builderforce
 * connection) it auto-approves so local runs are never hard-blocked.
 */

import type { AgentTool, AgentToolResult } from "../model/agent-types.js";
import { Type } from "@sinclair/typebox";
import { jsonResult } from "../../agents/tools/common.js";
import { requestHumanInput, type RequestKind } from "../../infra/approval-gate.js";

const AskHumanSchema = Type.Object({
  kind: Type.Optional(
    Type.Union(
      [Type.Literal("approval"), Type.Literal("question"), Type.Literal("feedback")],
      {
        description:
          "What you need from the human. 'approval' = approve/reject a high-risk action before you run it; 'question' = you are blocked and need a free-text answer to proceed; 'feedback' = you want a human to review your work and comment. Defaults to 'question'.",
      },
    ),
  ),
  actionType: Type.String({
    description:
      "Short machine-readable label for what this is about (e.g. 'git.push', 'delete.files', 'clarify.requirements', 'review.plan'). Used for grouping/auto-rules.",
  }),
  description: Type.String({
    description:
      "The full message for the human: the exact question to answer, the action to approve (with its consequences), or what to review. Be specific — this is all the human sees.",
  }),
  timeoutMinutes: Type.Optional(
    Type.Number({
      description: "How long to wait for a human before giving up. Defaults to 10 minutes.",
    }),
  ),
});

type AskHumanParams = {
  kind?: RequestKind;
  actionType: string;
  description: string;
  timeoutMinutes?: number;
};

export const askHumanTool: AgentTool<typeof AskHumanSchema, string> = {
  name: "ask_human",
  label: "Ask Human",
  description:
    "Escalate to a human and wait for their response. Use for: approval of risky/destructive/irreversible actions (deleting data, pushing to main, spending money, sending external messages); a blocking question you can't answer yourself; or to request review/feedback. BLOCKS until the human responds in the portal or it times out. Don't use it for trivial decisions you can make yourself.",
  parameters: AskHumanSchema,
  async execute(_toolCallId: string, params: AskHumanParams) {
    const kind: RequestKind = params.kind ?? "question";
    const { actionType, description } = params;

    if (!actionType?.trim() || !description?.trim()) {
      return jsonResult({
        error: "actionType and description are required",
      }) as AgentToolResult<string>;
    }

    const timeoutMs =
      params.timeoutMinutes && params.timeoutMinutes > 0
        ? Math.round(params.timeoutMinutes * 60 * 1000)
        : undefined;

    try {
      const result = await requestHumanInput({ kind, actionType, description, timeoutMs });

      if (result.decision === "timeout") {
        return jsonResult({
          decision: "timeout",
          message:
            "No human responded in time. Do not assume approval — either retry the escalation, choose a safe default and say you did, or stop and explain you are waiting on a human.",
        }) as AgentToolResult<string>;
      }

      if (kind === "approval") {
        return jsonResult({
          decision: result.decision, // "approved" | "rejected"
          approved: result.decision === "approved",
          message:
            result.decision === "approved"
              ? "A human approved this action. You may proceed."
              : "A human rejected this action. Do not proceed; adapt or stop.",
        }) as AgentToolResult<string>;
      }

      // question / feedback → an answer (or, in standalone mode, an auto-approve with no text)
      return jsonResult({
        decision: result.decision,
        answer: result.responseText ?? null,
        message: result.responseText
          ? "A human responded. Use their answer to continue."
          : "No human is available (standalone mode); proceed using your best judgment.",
      }) as AgentToolResult<string>;
    } catch (error) {
      return jsonResult({
        error: `Failed to reach a human: ${error instanceof Error ? error.message : String(error)}`,
      }) as AgentToolResult<string>;
    }
  },
};
