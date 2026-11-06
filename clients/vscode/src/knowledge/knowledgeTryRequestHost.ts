/**
 * The extension-host wiring of the sandbox Send (`knowledgeTryRequest.ts` holds the rules): the Node
 * transport, the person's confirmation, the USER-level `builderforce.knowledge.devOrigins` and the
 * refusals in the person's language.
 */

import * as vscode from "vscode";
import type { KnowledgeTryRequest, KnowledgeTryResponse } from "./knowledgeProtocol";
import { logLine } from "../errorReporter";
import { createTryRunner, devOriginsFromInspect, userFailureOf, type TryRefusal } from "./knowledgeTryRequest";
import { nodeOpen } from "./knowledgeTryTransport";

const runner = createTryRunner({
  open: nodeOpen,
  now: () => Date.now(),
  async confirm(key) {
    const send = vscode.l10n.t("Send");
    const answer = await vscode.window.showWarningMessage(vscode.l10n.t("Send this request to {0}? Only continue if you trust that address.", key), { modal: true }, send);
    return answer === send;
  },
});

function refusal(code: TryRefusal): string {
  switch (code) {
    case "origin": return vscode.l10n.t("Send only reaches localhost and the origins listed in the builderforce.knowledge.devOrigins setting.");
    case "timeout": return vscode.l10n.t("The server did not answer in time.");
    case "method": return vscode.l10n.t("That request method cannot be sent from here.");
    case "url": return vscode.l10n.t("That is not a valid address.");
    case "shape": return vscode.l10n.t("That request is not valid.");
    case "port": return vscode.l10n.t("Send does not reach that port.");
    case "declined": return vscode.l10n.t("The request was not sent to that address.");
    case "busy": return vscode.l10n.t("Another request is still running.");
    case "size": return vscode.l10n.t("The response is too large.");
    case "connect": return vscode.l10n.t("Could not connect.");
  }
}

/** Only the person's own (user-level) setting counts: a workspace's `.vscode/settings.json` must not widen where Send goes. */
const userDevOrigins = (): string[] =>
  devOriginsFromInspect(vscode.workspace.getConfiguration("builderforce").inspect<unknown[]>("knowledge.devOrigins"));

export async function tryRequestOf(req: KnowledgeTryRequest): Promise<KnowledgeTryResponse> {
  try {
    return await runner.run(req, userDevOrigins());
  } catch (error) {
    throw userFailureOf(error, refusal, logLine);
  }
}
