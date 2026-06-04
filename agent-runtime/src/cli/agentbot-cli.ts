import type { Command } from "commander";
import { registerQrCli } from "./qr-cli.js";

export function registerAgentbotCli(program: Command) {
  const agentbot = program.command("agentbot").description("Legacy agentbot command aliases");
  registerQrCli(agentbot);
}
