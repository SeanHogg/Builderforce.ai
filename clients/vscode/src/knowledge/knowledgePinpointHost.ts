/**
 * The editor's pinpoint adapters (PRD 38, Option B+). The matching is the shared core
 * (`@builderforce/agent-tools/knowledge` `matchAnchors`); this file supplies only:
 *
 *   vision  - THE shared vision request's messages (`pinpointVisionRequest`, no pinned model)
 *             through the routed completion the review's judgement uses (`routeComplete`).
 *             A local text-only route fails and says so (`IMAGE_NEEDS_GATEWAY`); the gateway
 *             moves an image request to a vision model;
 *   search  - the editor's `search_code` backend (`searchWorkspace`: ripgrep, with the
 *             in-process walk as fallback), literal text, root-relative paths.
 */

import * as fs from "fs/promises";
import * as path from "path";
import type * as vscode from "vscode";
import { checkPinpointDataUrl, matchAnchors, parseVisionReply, pinpointVisionRequest } from "@builderforce/agent-tools/knowledge";
import type { ChatMessage } from "../gateway";
import { resolveModelRoute, routeComplete } from "../modelRouting";
import { findRipgrep } from "../ripgrep";
import { searchWorkspace } from "../workspaceSearch";
import type { KnowledgePinpointResult } from "./knowledgeProtocol";
import type { KnowledgeRoot } from "./knowledgeRoots";
import { loadGraph } from "./knowledgeService";

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function pinpointRoot(secrets: vscode.SecretStorage, root: KnowledgeRoot, image: unknown): Promise<KnowledgePinpointResult> {
  checkPinpointDataUrl(image);
  const ripgrep = await findRipgrep().catch(() => null);
  const request = pinpointVisionRequest(image);
  const reply = await routeComplete(
    await resolveModelRoute(secrets), secrets, request.messages as ChatMessage[], undefined,
    { temperature: request.temperature, maxTokens: request.max_tokens },
  );
  const seen = parseVisionReply(reply);
  return matchAnchors({
    rootId: root.rootId,
    search: async (literal) => {
      const found = await searchWorkspace({ root: root.rootPath, start: root.rootPath, query: escapeRegex(literal), ripgrep });
      return found.ok ? ((found.matches ?? []) as Array<{ path: string; line: number; text: string }>) : [];
    },
    readText: (rel) => fs.readFile(path.join(root.rootPath, rel), "utf-8").catch(() => undefined),
    graph: () => loadGraph(secrets, root.rootId, { maxNodes: 2000 }),
  }, seen);
}
