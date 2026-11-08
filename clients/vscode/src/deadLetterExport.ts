/**
 * The person-facing `builderforce.exportDeadLetters` command (G13a), registered on the activation path.
 * It exports what is waiting (the write-outbox queues) and offers to put
 * exactly ONE back; it never sends, flushes or retries, and it never calls the platform.
 */

import * as vscode from "vscode";
import type { LocalFirstStore } from "@builderforce/local-first";
import { EXPORT_DEAD_LETTERS_COMMAND, runExportDeadLetters } from "./deadLetterCommand";
import { surfaceError } from "./errorReporter";

export function registerDeadLetterExport(context: vscode.ExtensionContext, store: LocalFirstStore): void {
  // G13a: the person-facing entry point for durable dead letters. `runExportDeadLetters`
  // exports what is waiting and offers to put exactly ONE back on the queue it came
  // from; it never sends, flushes or retries, and it never calls the platform. It is
  // registered HERE, on the activation path, rather than lazily behind a first call,
  // so a person can always reach it from the Command Palette — the manifest
  // declaration in package.json is what puts it there, and neither half works alone.
  context.subscriptions.push(
    vscode.commands.registerCommand(EXPORT_DEAD_LETTERS_COMMAND, async () => {
      try {
        await runExportDeadLetters({
          showExport: async (content) => {
            const document = await vscode.workspace.openTextDocument({ language: "json", content });
            await vscode.window.showTextDocument(document, { preview: true });
          },
          offerRepair: async (choices) => {
            const picked = await vscode.window.showQuickPick(
              choices.map((choice) => ({
                label: choice.id,
                description: choice.queue,
                detail: choice.reason || vscode.l10n.t("Durable dead letter"),
                letterId: choice.id,
              })),
              {
                title: vscode.l10n.t("Repair a dead letter"),
                placeHolder: vscode.l10n.t("Put one durable dead letter back on the queue. Nothing is sent."),
              },
            );
            return picked?.letterId;
          },
          showInfo: (message) => {
            void vscode.window.showInformationMessage(message);
          },
        }, {
          storage: {
            keys: () => context.workspaceState.keys(),
            get: (key) => context.workspaceState.get(key),
            update: (key, value) => context.workspaceState.update(key, value),
          },
        });
      } catch (error) {
        surfaceError(error, "command:exportDeadLetters",
          vscode.l10n.t("Could not export dead letters: {0}", (error as Error).message));
      }
    }),
  );
}
