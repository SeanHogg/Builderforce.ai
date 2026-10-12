/**
 * The trust gate for a workspace's hook COMMANDS.
 *
 * `.builderforce/hooks.json` is committed, so it arrives with a clone — and a command in it
 * runs on this machine. The person approves the exact set of commands once (keyed by
 * `commandsDigest`, so changing or adding a command asks again; editing a prompt does
 * not), and nothing runs in an untrusted (Restricted Mode) workspace. Prompt hooks and
 * rules are text the agent reads, like any file in the repository, and need no approval.
 */

import * as vscode from "vscode";
import type { WorkspaceHook } from "./hookConfig";

const APPROVED_KEY = "builderforce.hooks.approvedDigest";

/** Digests declined this session — asked once, not on every run. */
const declined = new Set<string>();
/** One prompt per digest even when several runs start at once. */
const asking = new Map<string, Promise<boolean>>();

export async function hookCommandsAllowed(
  state: vscode.Memento,
  digest: string,
  hooks: readonly WorkspaceHook[],
): Promise<boolean> {
  if (!digest) return true;
  if (!vscode.workspace.isTrusted) return false;
  if (state.get<string>(APPROVED_KEY) === digest) return true;
  if (declined.has(digest)) return false;
  const pending = asking.get(digest);
  if (pending) return pending;

  const ask = (async () => {
    const allow = vscode.l10n.t("Allow commands");
    const commands = hooks.filter((h) => h.command).map((h) => `${h.on}${h.on === "preTool" || h.on === "postTool" ? ` (${h.tool})` : ""}: ${h.command}`);
    const choice = await vscode.window.showWarningMessage(
      vscode.l10n.t("This workspace's .builderforce/hooks.json runs commands during BuilderForce agent runs. Allow them on this machine?"),
      { modal: true, detail: commands.join("\n") },
      allow,
    );
    if (choice === allow) {
      await state.update(APPROVED_KEY, digest);
      return true;
    }
    declined.add(digest);
    return false;
  })();
  asking.set(digest, ask);
  try {
    return await ask;
  } finally {
    asking.delete(digest);
  }
}
