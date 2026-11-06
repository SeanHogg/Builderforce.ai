/**
 * The editor's judgement port for a review (PRD 38 §4.3, §8.2): routed LOCAL ENGINES FIRST,
 * then the gateway — the same two seams the editor's other small structured calls use
 * (`completeOnDevice`, `routeComplete` in `modelRouting.ts`), with the shared prompts and
 * memory's validators (`completionJudgement`).
 *
 *   - a model on this machine, when one is running (free tokens);
 *   - then, linked to a project, the platform's routed judge call (`client.judgement` —
 *     metered as `knowledge_judge` with the project), else the editor's own route;
 *   - Local only never reaches the gateway: a review with no local model runs
 *     extracted-only (§5.4).
 */

import type * as vscode from "vscode";
import { completionJudgement, fallbackJudgement, type JudgeCompletion } from "@builderforce/agent-tools/knowledge";
import type { JudgementPort } from "@seanhogg/builderforce-memory/knowledge";
import type { KnowledgeClient } from "@builderforce/knowledge-client";
import { completeOnDevice, onDeviceModelAvailable, resolveModelRoute, routeComplete } from "../modelRouting";
import { currentInferenceMode } from "../inferenceModeSetting";
import type { ChatMessage } from "../gateway";

const messagesOf = (system: string, user: string): ChatMessage[] => [
  { role: "system", content: system },
  { role: "user", content: user },
];

/** A judgement port that also names the models that actually answered (for a pack's provenance). */
export interface TrackedJudgement extends JudgementPort {
  /** The model refs that served a judgement call, in first-use order; empty when none ran or the answerer names no model (the platform's judge). */
  modelsUsed(): string[];
}

/** The review's judgement port, resolved once per review; undefined when nothing may judge. */
export async function editorJudgement(secrets: vscode.SecretStorage, client?: KnowledgeClient): Promise<TrackedJudgement | undefined> {
  const ports: JudgementPort[] = [];
  const used = new Set<string>();
  if (await onDeviceModelAvailable().catch(() => false)) {
    const local: JudgeCompletion = ({ system, user, signal }) => completeOnDevice(messagesOf(system, user), signal, (ref) => used.add(ref));
    ports.push(completionJudgement(local));
  }
  if (currentInferenceMode() !== "local-only") {
    if (client) {
      ports.push(client.judgement);
    } else {
      const routed: JudgeCompletion = async ({ system, user, signal }) => {
        const route = await resolveModelRoute(secrets);
        const reply = await routeComplete(route, secrets, messagesOf(system, user), signal);
        if (route.model) used.add(route.model);
        return reply;
      };
      ports.push(completionJudgement(routed));
    }
  }
  return ports.length > 0 ? { ...fallbackJudgement(ports), modelsUsed: () => [...used] } : undefined;
}
