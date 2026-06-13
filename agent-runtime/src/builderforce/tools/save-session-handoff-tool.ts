/**
 * Tool for saving a session handoff document.
 *
 * Legacy pi (`AgentTool`) wrapper — the implementation lives once in the pi-free
 * `shared-tools/node-orchestration-tools.ts` (`runSaveSessionHandoff`), shared with
 * the native `ToolDefinition` (DRY). Removed when the pi loop is retired.
 */

import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { jsonResult } from "../../agents/tools/common.js";
import { runSaveSessionHandoff } from "../shared-tools/node-orchestration-tools.js";

const SaveSessionHandoffSchema = Type.Object({
  projectRoot: Type.String({ description: "Root directory of the project" }),
  sessionId: Type.Optional(
    Type.String({
      description: "Session identifier. If omitted, a new UUID is generated. Use the current session ID if known.",
    }),
  ),
  summary: Type.String({ description: "One-paragraph summary of what was accomplished in this session" }),
  decisions: Type.Optional(Type.Array(Type.String(), { description: "Key decisions made during the session" })),
  nextSteps: Type.Optional(Type.Array(Type.String(), { description: "Concrete next steps for the following session" })),
  openQuestions: Type.Optional(
    Type.Array(Type.String(), { description: "Unresolved questions to revisit in the next session" }),
  ),
  artifacts: Type.Optional(
    Type.Array(Type.String(), {
      description: "Files, docs, or other artifacts produced (file paths or descriptions)",
    }),
  ),
});

type SaveSessionHandoffParams = {
  projectRoot: string;
  sessionId?: string;
  summary: string;
  decisions?: string[];
  nextSteps?: string[];
  openQuestions?: string[];
  artifacts?: string[];
};

export const saveSessionHandoffTool: AgentTool<typeof SaveSessionHandoffSchema, string> = {
  name: "save_session_handoff",
  label: "Save Session Handoff",
  description:
    "Save a session handoff document to .builderforce/sessions/ so the next session can resume from where this one left off. Call this at the end of a session or when switching to a major new task. Include a clear summary, decisions made, next steps, and any open questions.",
  parameters: SaveSessionHandoffSchema,
  async execute(_toolCallId: string, params: SaveSessionHandoffParams) {
    return jsonResult(
      await runSaveSessionHandoff(params.projectRoot, {
        sessionId: params.sessionId,
        summary: params.summary,
        decisions: params.decisions,
        nextSteps: params.nextSteps,
        openQuestions: params.openQuestions,
        artifacts: params.artifacts,
      }),
    ) as AgentToolResult<string>;
  },
};
