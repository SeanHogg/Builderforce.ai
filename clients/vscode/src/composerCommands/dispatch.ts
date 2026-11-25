/**
 * The ONE answer to a composer line in the extension host (PRD 31 §W11, Rev 2 item 10):
 * brain-embedded's deterministic parser decides whether the line is a command, and a
 * command is answered HERE — run, refused or explained — and never forwarded to the model.
 *
 * - `message` → not handled: the chat sends it as usual (`/api/users returns 500` is one).
 * - `escaped` (`//…`) → not handled, with the one-slash text to send.
 * - `/help [command]` → the registry's help model.
 * - unknown → "no such command" + every command.
 * - invalid → its problems, worded, + that command's help.
 * - unavailable → the reason.
 * - a command → its executor (a throw is reported in the reply, never swallowed).
 */
import {
  HELP_COMMAND_ID,
  parseComposerInput,
  type ComposerCommandRegistry,
} from "@seanhogg/builderforce-brain-embedded/composerCommands";
import type { ComposerCommandText } from "./labels";
import type { ComposerInputResult, ComposerReply } from "./reply";
import { messageOf } from "../shared/messageOf";
import { WriteRefusedError, writeRefusedReply } from "./writeContainment";

/** Runs one parsed command. `args` are the parser's canonical values. */
export type ComposerCommandExecutor = (args: Record<string, string | string[]>) => Promise<ComposerReply>;

/**
 * One executor per value of a command's `action` argument (`/manifest init | move`). The parser
 * has already refused any value not in the command's choices, so a missing executor is a host
 * wiring error: it throws, and `handleComposerInput` reports it.
 */
export function actionExecutor(actions: Readonly<Record<string, ComposerCommandExecutor>>): ComposerCommandExecutor {
  return async (args) => {
    const action = String(args.action);
    const run = actions[action];
    if (!run) throw new Error(`no executor for the "${action}" action`);
    return run(args);
  };
}

export interface ComposerDispatchDeps {
  registry: ComposerCommandRegistry;
  text: ComposerCommandText;
  /** By command id. A registered command with no executor is a host wiring error, answered as a failure. */
  executors: Readonly<Record<string, ComposerCommandExecutor>>;
}

const errorReply = (lines: string[]): ComposerReply => ({ kind: "text", tone: "error", lines });

export async function handleComposerInput(text: string, deps: ComposerDispatchDeps): Promise<ComposerInputResult> {
  const { registry, text: copy, executors } = deps;
  const input = parseComposerInput(text, registry);
  switch (input.kind) {
    case "message":
      return { handled: false };
    case "escaped":
      return { handled: false, text: input.text };
    case "unknown":
      return { handled: true, reply: { kind: "help", help: registry.helpForUnknown(input.name) } };
    case "unavailable":
      return { handled: true, reply: errorReply([copy.unavailable(input.id, input.reason)]) };
    case "invalid":
      return {
        handled: true,
        reply: { kind: "help", help: registry.help(input.id), lines: [copy.invalid(input.id), ...input.problems.map((problem) => copy.problem(problem))] },
      };
    case "command": {
      if (input.id === HELP_COMMAND_ID) {
        const about = input.args.command;
        return { handled: true, reply: { kind: "help", help: registry.help(typeof about === "string" ? about : undefined) } };
      }
      const run = executors[input.id];
      // A registered id with no executor is a wiring error; it is answered like a command this host does not have.
      if (!run) return { handled: true, reply: { kind: "help", help: registry.helpForUnknown(input.id) } };
      try {
        return { handled: true, reply: await run(input.args) };
      } catch (error) {
        // A write the containment check refused at write time: named, in the person's language.
        if (error instanceof WriteRefusedError) return { handled: true, reply: writeRefusedReply(copy, error.refusals) };
        return { handled: true, reply: errorReply([copy.failed(input.id, messageOf(error))]) };
      }
    }
  }
}
