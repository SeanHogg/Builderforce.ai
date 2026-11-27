import * as vscode from "vscode";
import type { BrainRunHost } from "../brain/brainRunHost";
import { createBuilderForceTurn } from "./builderforceTurn";
import { signalOfToken, type TurnInput, type TurnResult, type TurnSink } from "./turnSink";

interface RunAgentInput {
  task?: unknown;
  continueChatId?: unknown;
}

type RunTurn = (input: TurnInput, sink: TurnSink) => Promise<TurnResult>;

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

const taskOf = (input: RunAgentInput | undefined): string => String(input?.task ?? "").trim();
const textResult = (text: string) => new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);

/** The tool over a turn runner (the seam `runAgentTool.test.ts` drives). */
export function createRunAgentTool(runTurn: RunTurn): vscode.LanguageModelTool<RunAgentInput> {
  return {
    prepareInvocation: (options) => ({
      invocationMessage: vscode.l10n.t("BuilderForce is working on: {0}", taskOf(options.input).slice(0, 80)),
    }),
    invoke: async (options, token) => {
      const task = taskOf(options.input);
      if (!task) return textResult(vscode.l10n.t("Give BuilderForce a task to work on."));
      const chatId = options.input.continueChatId;
      const priorChatId = typeof chatId === "number" && Number.isSafeInteger(chatId) && chatId > 0 ? chatId : undefined;
      const { sink, text } = bufferSink();
      const cancel = signalOfToken(token);
      let brainChatId: number | undefined;
      try {
        ({ brainChatId } = await runTurn({ prompt: task, ...(priorChatId != null ? { priorChatId } : {}), references: [], signal: cancel.signal }, sink));
        if (cancel.signal.aborted) throw new vscode.CancellationError();
      } finally {
        cancel.dispose();
      }
      const report = text().trim() || vscode.l10n.t("BuilderForce finished without a reply.");
      const footer = brainChatId == null ? "" : `\n\n${vscode.l10n.t("BuilderForce chat {0} — pass continueChatId: {0} to continue this conversation.", brainChatId)}`;
      return textResult(report + footer);
    },
  };
}

/**
 * Registers `builderforce_runAgent`: the language-model tool the BuilderForce chat agent (`assets/agents/builderforce.agent.md`)
 * calls to hand a task to BuilderForce. It runs the ONE shared turn (`builderforceTurn.ts`) and returns the final report.
 */
export function registerRunAgentTool(ctx: vscode.ExtensionContext, runHost: BrainRunHost): vscode.Disposable {
  if (typeof vscode.lm?.registerTool !== "function") return new vscode.Disposable(() => undefined);
  return vscode.lm.registerTool<RunAgentInput>("builderforce_runAgent", createRunAgentTool(createBuilderForceTurn(ctx, runHost)));
}
