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

/** Runs one parsed command. `args` are the parser's canonical values. */
export type ComposerCommandExecutor = (args: Record<string, string | string[]>) => Promise<ComposerReply>;

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
        return { handled: true, reply: errorReply([copy.failed(input.id, error instanceof Error ? error.message : String(error))]) };
      }
    }
  }
}
