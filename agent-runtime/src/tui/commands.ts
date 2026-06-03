import type { SlashCommand } from "@mariozechner/pi-tui";
import { listChatCommands, listChatCommandsForConfig } from "../auto-reply/commands-registry.js";
import { formatThinkingLevels, listThinkingLevelLabels } from "../auto-reply/thinking.js";
import type { BuilderForceAgentsConfig } from "../config/types.js";

const VERBOSE_LEVELS = ["on", "off"];
const REASONING_LEVELS = ["on", "off"];
const ELEVATED_LEVELS = ["on", "off", "ask", "full"];
const ACTIVATION_LEVELS = ["mention", "always"];
const USAGE_FOOTER_LEVELS = ["off", "tokens", "full"];

export type ParsedCommand = {
  name: string;
  args: string;
};

export type SlashCommandOptions = {
  cfg?: BuilderForceAgentsConfig;
  provider?: string;
  model?: string;
};

const COMMAND_ALIASES: Record<string, string> = {
  elev: "elevated",
  onboard: "setup",
  service: "gateway",
};

export function parseCommand(input: string): ParsedCommand {
  const trimmed = input.replace(/^\//, "").trim();
  if (!trimmed) {
    return { name: "", args: "" };
  }
  const [name, ...rest] = trimmed.split(/\s+/);
  const normalized = name.toLowerCase();
  return {
    name: COMMAND_ALIASES[normalized] ?? normalized,
    args: rest.join(" ").trim(),
  };
}

export function getSlashCommands(options: SlashCommandOptions = {}): SlashCommand[] {
  const thinkLevels = listThinkingLevelLabels(options.provider, options.model);
  const commands: SlashCommand[] = [
    { name: "help", description: "Show slash command help" },
    { name: "status", description: "Show gateway status summary" },
    { name: "agent", description: "Switch agent (or open picker)" },
    { name: "agents", description: "Open agent picker" },
    { name: "session", description: "Switch session (or open picker)" },
    { name: "sessions", description: "Open session picker" },
    {
      name: "model",
      description: "Set model (or open picker)",
    },
    { name: "models", description: "Open model picker" },
    {
      name: "think",
      description: "Set thinking level",
      getArgumentCompletions: (prefix) =>
        thinkLevels
          .filter((v) => v.startsWith(prefix.toLowerCase()))
          .map((value) => ({ value, label: value })),
    },
    {
      name: "verbose",
      description: "Set verbose on/off",
      getArgumentCompletions: (prefix) =>
        VERBOSE_LEVELS.filter((v) => v.startsWith(prefix.toLowerCase())).map((value) => ({
          value,
          label: value,
        })),
    },
    {
      name: "reasoning",
      description: "Set reasoning on/off",
      getArgumentCompletions: (prefix) =>
        REASONING_LEVELS.filter((v) => v.startsWith(prefix.toLowerCase())).map((value) => ({
          value,
          label: value,
        })),
    },
    {
      name: "usage",
      description: "Toggle per-response usage line",
      getArgumentCompletions: (prefix) =>
        USAGE_FOOTER_LEVELS.filter((v) => v.startsWith(prefix.toLowerCase())).map((value) => ({
          value,
          label: value,
        })),
    },
    {
      name: "elevated",
      description: "Set elevated on/off/ask/full",
      getArgumentCompletions: (prefix) =>
        ELEVATED_LEVELS.filter((v) => v.startsWith(prefix.toLowerCase())).map((value) => ({
          value,
          label: value,
        })),
    },
    {
      name: "elev",
      description: "Alias for /elevated",
      getArgumentCompletions: (prefix) =>
        ELEVATED_LEVELS.filter((v) => v.startsWith(prefix.toLowerCase())).map((value) => ({
          value,
          label: value,
        })),
    },
    {
      name: "activation",
      description: "Set group activation",
      getArgumentCompletions: (prefix) =>
        ACTIVATION_LEVELS.filter((v) => v.startsWith(prefix.toLowerCase())).map((value) => ({
          value,
          label: value,
        })),
    },
    { name: "abort", description: "Abort active run" },
    { name: "new", description: "Reset the session" },
    { name: "reset", description: "Reset the session" },
    { name: "settings", description: "Open settings" },
    {
      name: "restart",
      description: "Restart gateway locally",
    },
    {
      name: "gateway",
      description: "Gateway control (status/start/stop/restart/token <value>)",
    },
    { name: "daemon", description: "Alias for /gateway" },
    { name: "logs", description: "Show recent gateway log lines" },
    { name: "init", description: "Initialize builderForceAgents project in workspace" },
    {
      name: "handoff",
      description: "Ask the agent to save a session handoff for the next session",
    },
    { name: "exit", description: "Exit the TUI" },
    { name: "quit", description: "Exit the TUI" },
    { name: "setup", description: "Run the setup/onboarding wizard" },
    { name: "onboard", description: "Alias for /setup" },
    {
      name: "localbrain",
      description: "Toggle local brain on/off/refresh",
      getArgumentCompletions: (prefix) =>
        ["on", "off", "refresh"]
          .filter((v) => v.startsWith(prefix.toLowerCase()))
          .map((value) => ({ value, label: value })),
    },
    { name: "project", description: "Show project context from .builderForceAgents directory" },
    { name: "sync", description: "Force sync .builderForceAgents directory to Builderforce" },
    {
      name: "spec",
      description: "Run a spec-driven planning workflow (PRD → architecture → tasks)",
    },
    {
      name: "workflow",
      description: "Show status of the latest (or a specific) workflow",
    },
    {
      name: "diff",
      description: "Show staged file changes (or a specific file). Use after agent edits.",
    },
    {
      name: "accept",
      description: "Apply staged changes to disk. /accept [file] or /accept all",
    },
    {
      name: "reject",
      description: "Discard staged changes. /reject [file] or /reject all",
    },
  ];

  const seen = new Set(commands.map((command) => command.name));
  const gatewayCommands = options.cfg ? listChatCommandsForConfig(options.cfg) : listChatCommands();
  for (const command of gatewayCommands) {
    const aliases = command.textAliases.length > 0 ? command.textAliases : [`/${command.key}`];
    for (const alias of aliases) {
      const name = alias.replace(/^\//, "").trim();
      if (!name || seen.has(name)) {
        continue;
      }
      seen.add(name);
      commands.push({ name, description: command.description });
    }
  }

  return commands;
}

export function helpText(options: SlashCommandOptions = {}): string {
  const thinkLevels = formatThinkingLevels(options.provider, options.model, "|");
  return [
    "Slash commands:",
    "/help",
    "/commands",
    "/status",
    "/agent <id> (or /agents)",
    "/session <key> (or /sessions)",
    "/model <provider/model> (or /models)",
    `/think <${thinkLevels}>`,
    "/verbose <on|off>",
    "/reasoning <on|off>",
    "/usage <off|tokens|full>",
    "/elevated <on|off|ask|full>",
    "/elev <on|off|ask|full>",
    "/activation <mention|always>",
    "/new or /reset",
    "/abort",
    "/compact [instructions]",
    "/settings",
    "/restart (restart gateway; works when disconnected)",
    "/gateway <status|start|stop|restart|token <value>>",
    "/daemon <status|start|stop|restart|token <value>>",
    "/logs [count]",
    "/init",
    "/handoff",
    "/project",
    "/sync",
    "/spec <goal>",
    "/workflow [id]",
    "/diff [file]",
    "/accept [file|all]",
    "/reject [file|all]",
    "/exit",
    "/localbrain <on|off|refresh>",
    "/setup or /onboard",
  ].join("\n");
}
