import type { Command } from "commander";
import { connectAgentHeadless } from "../../commands/builderforce-connect.js";
import { theme } from "../../terminal/theme.js";

export function registerConnectCommand(program: Command) {
  program
    .command("connect")
    .description(
      "Register this machine as an agent host in a Builderforce workspace (non-interactive)",
    )
    .option("--token <jwt>", "Workspace token (defaults to $BUILDERFORCE_TOKEN)")
    .option("--workspace <slug>", "Workspace slug (defaults to $BUILDERFORCE_WORKSPACE)")
    .option(
      "--api-url <url>",
      "Builderforce API base URL (defaults to $BUILDERFORCE_URL or https://api.builderforce.ai)",
    )
    .option("--name <name>", "Display name for this agent host (defaults to hostname)")
    .action(async (opts) => {
      const token = (opts.token as string | undefined) ?? process.env.BUILDERFORCE_TOKEN;
      const apiUrl = (opts.apiUrl as string | undefined) ?? process.env.BUILDERFORCE_URL;
      try {
        const result = await connectAgentHeadless({
          token: token ?? "",
          apiUrl,
          name: opts.name as string | undefined,
        });
        console.log(theme.heading(`✓ Connected as agent host "${result.name}" (id ${result.id})`));
        console.log(theme.muted("  Start it with:  builderforce gateway"));
      } catch (err) {
        console.error(theme.muted(String(err instanceof Error ? err.message : err)));
        process.exitCode = 1;
      }
    });
}
