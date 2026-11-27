import * as vscode from "vscode";
import type { BrainRunHost } from "../brain/brainRunHost";
import { createBuilderForceTurn, type TurnSink } from "./builderforceTurn";

interface RunAgentInput {
  task: string;
  continueChatId?: number;
}

/** A sink that buffers the turn's text for the tool result; tool progress labels are not part of the report. */
function bufferSink(): { sink: TurnSink; text: () => string } {
  let text = "";
  return {
    sink: {
      markdown: (chunk) => void (text += chunk),
      progress: () => undefined,
      button: (cmd) => void (text += `\n${vscode.l10n.t('Run the command "{0}" ({1}).', cmd.title, cmd.command)}\n`),
    },
    text: () => text,
  };
}

/**
 * Registers `builderforce_runAgent`: the language-model tool the BuilderForce chat agent (`assets/agents/builderforce.agent.md`)
 * calls to hand a task to BuilderForce. It runs the ONE shared turn (`builderforceTurn.ts`) and returns the final report.
 */
export function registerRunAgentTool(ctx: vscode.ExtensionContext, runHost: BrainRunHost): vscode.Disposable {
  if (typeof vscode.lm?.registerTool !== "function") return new vscode.Disposable(() => undefined);
  const runTurn = createBuilderForceTurn(ctx, runHost);
  return vscode.lm.registerTool<RunAgentInput>("builderforce_runAgent", {
    prepareInvocation: (options) => ({
      invocationMessage: vscode.l10n.t("BuilderForce is working on: {0}", options.input.task.trim().slice(0, 80)),
    }),
    invoke: async (options, token) => {
      const { sink, text } = bufferSink();
      const { brainChatId } = await runTurn(
        { prompt: options.input.task, seed: [], priorChatId: options.input.continueChatId, references: [], isCancelled: () => token.isCancellationRequested },
        sink,
      );
      const report = text().trim();
      const footer = brainChatId == null ? "" : `\n\n${vscode.l10n.t("BuilderForce chat {0} — pass continueChatId: {0} to continue this conversation.", brainChatId)}`;
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart((report || vscode.l10n.t("BuilderForce finished without a reply.")) + footer),
      ]);
    },
  });
}
