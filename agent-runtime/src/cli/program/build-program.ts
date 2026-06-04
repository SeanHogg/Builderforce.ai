import { Command } from "commander";
import { registerProgramCommands } from "./command-registry.js";
import { createProgramContext } from "./context.js";
import { configureProgramHelp } from "./help.js";
import { registerPreActionHooks } from "./preaction.js";
import { setProgramContext } from "./program-context.js";

export function buildProgram() {
  const program = new Command();
  const ctx = createProgramContext();
  const argv = process.argv;

  setProgramContext(program, ctx);
  configureProgramHelp(program, ctx);
  registerPreActionHooks(program, ctx.programVersion);

  registerProgramCommands(program, ctx, argv);

  // Default action: when `builderforce` is invoked with no subcommand, launch the
  // Claude Code-style persistent session instead of showing help.
  // Also accept `-m`/`--message` so `builderforce -m "fix tests"` pre-fills the first prompt.
  program
    .option("-m, --message <text>", "Start a session and send this as the first message")
    .action(async (opts: { message?: string }) => {
      const { runBuilderForceAgentsSession } = await import("../../commands/builderforce.js");
      await runBuilderForceAgentsSession(process.cwd(), { message: opts.message });
    });

  return program;
}
