/**
 * The editor's price of one judged section, for the review's confirm chip (PRD 38 §3.1) —
 * resolved in the SAME order `editorJudgement` judges in: an on-device engine first (local,
 * free), then the linked project's routed call, whose price is the server's estimate
 * (`GET …/knowledge/judge/estimate`). An unlinked workspace with no local engine routes
 * straight to the gateway and cannot say what the call costs: undefined ⇒ calls only.
 */

import type * as vscode from "vscode";
import type { ReviewCallPrice } from "@builderforce/agent-tools/knowledge";
import { onDeviceModelAvailable } from "../modelRouting";
import { currentInferenceMode } from "../inferenceModeSetting";
import { linkedKnowledgeClient } from "./knowledgeService";

export function editorCallPrice(secrets: vscode.SecretStorage): () => Promise<ReviewCallPrice | undefined> {
  return async () => {
    if (await onDeviceModelAvailable().catch(() => false)) return { perCallUsd: 0, local: true };
    if (currentInferenceMode() === "local-only") return undefined;
    return linkedKnowledgeClient(secrets)?.judgeEstimate();
  };
}
