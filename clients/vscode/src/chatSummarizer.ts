/**
 * The summarizer a LOCAL chat's "Consolidate" / "Fork" compresses with: the ONE
 * transcript summarizer (`@seanhogg/builderforce-memory/working`) over the same gateway
 * route a run streams on. Resolved per call, so a sign-in or a model change since the
 * panel opened is honoured.
 */

import type * as vscode from "vscode";
import { streamSummaryCompletion } from "@seanhogg/builderforce-brain-embedded";
import type { SummaryCompletion } from "@seanhogg/builderforce-memory/working";
import { getApiKey } from "./gateway";
import { resolveModelRoute, routeStream } from "./modelRouting";

export function gatewaySummaryCompletion(secrets: vscode.SecretStorage): SummaryCompletion {
  return async (request) => {
    const stream = routeStream(await resolveModelRoute(secrets, { turn: true }), await getApiKey(secrets));
    return streamSummaryCompletion(stream, undefined)(request);
  };
}
