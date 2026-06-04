import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Component, TUI } from "@mariozechner/pi-tui";
import { isModelCached } from "../agents/builderforcellm-syscheck.js";
import { downloadBuilderForceAgentsLlmModel } from "../agents/transformers-stream.js";
import {
  formatThinkingLevels,
  normalizeUsageDisplay,
  resolveResponseUsageMode,
} from "../auto-reply/thinking.js";
import {
  initializeBuilderForceAgentsProject,
  loadProjectContext,
  loadWorkspaceState,
  saveSessionHandoff,
} from "../builderforce/project-context.js";
import {
  buildStagedSummary,
  buildUnifiedDiff,
  acceptEdit,
  acceptAllEdits,
  rejectEdit,
  rejectAllEdits,
  getStagedEdit,
  getStagedEdits,
  hasStagedEdits,
} from "../builderforce/staged-edits.js";
import {
  AMYGDALA_MODEL_ID,
  AMYGDALA_DTYPE,
  HIPPOCAMPUS_MODEL_ID,
  HIPPOCAMPUS_DTYPE,
  BUILDERFORCE_AGENTSLLM_LOCAL_PROVIDER_ID,
  defaultCacheDir,
  applyTransformersProviderConfig,
} from "../commands/auth-choice.apply.transformers.js";
import { loadConfig, writeConfigFile } from "../config/config.js";
import type { BuilderForceAgentsConfig } from "../config/types.js";
import type { SessionsPatchResult } from "../gateway/protocol/index.js";
import { syncBuilderForceAgentsDirectoryWithMetaUpdate } from "../infra/builderforce-directory-sync.js";
import { readSharedEnvVar } from "../infra/env-file.js";
import { formatRelativeTimestamp } from "../infra/format-time/format-relative.ts";
import { logDebug, logWarn } from "../logger.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { normalizeBaseUrl } from "../utils/normalize-base-url.js";
import { helpText, parseCommand } from "./commands.js";
import type { ChatLog } from "./components/chat-log.js";
import {
  createFilterableSelectList,
  createSearchableSelectList,
  createSettingsList,
} from "./components/selectors.js";
import type { GatewayChatClient } from "./gateway-chat.js";
import { formatStatusSummary } from "./tui-status-summary.js";
import type {
  AgentSummary,
  GatewayStatusSummary,
  TuiOptions,
  TuiStateAccess,
} from "./tui-types.js";

type CommandHandlerContext = {
  client: GatewayChatClient;
  chatLog: ChatLog;
  tui: TUI;
  opts: TuiOptions;
  state: TuiStateAccess;
  deliverDefault: boolean;
  openOverlay: (component: Component) => void;
  closeOverlay: () => void;
  refreshSessionInfo: () => Promise<void>;
  loadHistory: () => Promise<void>;
  setSession: (key: string) => Promise<void>;
  refreshAgents: () => Promise<void>;
  abortActive: () => Promise<void>;
  setActivityStatus: (text: string) => void;
  reportAction?: (text: string) => void;
  formatSessionKey: (key: string) => string;
  applySessionInfoFromPatch: (result: SessionsPatchResult) => void;
  updateFooter?: () => void;
  noteLocalRunId: (runId: string) => void;
  forgetLocalRunId?: (runId: string) => void;
  onSetup?: () => Promise<void>;
  runGatewayServiceCommand?: (action: "status" | "start" | "stop" | "restart") => Promise<{
    ok: boolean;
    lines: string[];
  }>;
  runLocalCliCommand?: (args: string[]) => Promise<{ ok: boolean; lines: string[] }>;
  config?: BuilderForceAgentsConfig;
};

/**
 * Auto-checkpoint: write a minimal session handoff to .builderforce/sessions/ so
 * context is never silently lost when the user resets or exits the TUI.
 * Called fire-and-forget on /exit and awaited on /new (before reset clears history).
 */
async function autoCheckpointSession(chatLog: { hasUserMessages: () => boolean }): Promise<void> {
  if (!chatLog.hasUserMessages()) {
    return;
  }
  try {
    await saveSessionHandoff(process.cwd(), {
      sessionId: randomUUID(),
      timestamp: new Date().toISOString(),
      summary: "Session auto-checkpointed on exit/reset (no agent summary generated).",
      decisions: [],
      nextSteps: ["Review session history and run /handoff manually for a richer summary."],
      openQuestions: [],
      artifacts: [],
    });
  } catch {
    // Auto-checkpoint is best-effort — never block exit or reset
  }
}

async function executeGatewayServiceCommand(
  action: "status" | "start" | "stop" | "restart",
): Promise<{ ok: boolean; lines: string[] }> {
  return await new Promise((resolve) => {
    const args = [process.argv[1], "gateway", action, "--json"];
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (buf) => {
      stdout = (stdout + buf.toString("utf8")).slice(-20_000);
    });
    child.stderr.on("data", (buf) => {
      stderr = (stderr + buf.toString("utf8")).slice(-20_000);
    });

    child.on("close", (code, signal) => {
      const lines = [stdout, stderr]
        .filter(Boolean)
        .join("\n")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (signal) {
        lines.push(`terminated by signal ${String(signal)}`);
      }
      resolve({ ok: code === 0, lines });
    });

    child.on("error", (err) => {
      resolve({ ok: false, lines: [String(err)] });
    });
  });
}

async function executeLocalCliCommand(args: string[]): Promise<{ ok: boolean; lines: string[] }> {
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, [process.argv[1], ...args], {
      cwd: process.cwd(),
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (buf) => {
      stdout = (stdout + buf.toString("utf8")).slice(-20_000);
    });
    child.stderr.on("data", (buf) => {
      stderr = (stderr + buf.toString("utf8")).slice(-20_000);
    });

    child.on("close", (code, signal) => {
      const lines = [stdout, stderr]
        .filter(Boolean)
        .join("\n")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (signal) {
        lines.push(`terminated by signal ${String(signal)}`);
      }
      resolve({ ok: code === 0, lines });
    });

    child.on("error", (err) => {
      resolve({ ok: false, lines: [String(err)] });
    });
  });
}

export function createCommandHandlers(context: CommandHandlerContext) {
  const {
    client,
    chatLog,
    tui,
    opts,
    state,
    deliverDefault,
    openOverlay,
    closeOverlay,
    refreshSessionInfo,
    loadHistory,
    setSession,
    refreshAgents,
    abortActive,
    setActivityStatus,
    reportAction,
    formatSessionKey,
    applySessionInfoFromPatch,
    noteLocalRunId,
    forgetLocalRunId,
    onSetup,
    runGatewayServiceCommand,
    runLocalCliCommand,
    updateFooter,
  } = context;

  const runServiceCommand = runGatewayServiceCommand ?? executeGatewayServiceCommand;
  const runCliCommand = runLocalCliCommand ?? executeLocalCliCommand;

  const formatModelSetError = (err: unknown): string => {
    const message = String(err);
    if (message.toLowerCase().includes("model not allowed:")) {
      return `${message} (add it to allowlist with: builderforce models set <provider/model>, then retry /models)`;
    }
    return message;
  };

  const patchSessionModel = async (model: string): Promise<"updated" | "onboarding"> => {
    const normalized = model.trim().toLowerCase();
    const isBuilderForceAgentsLlm = normalized === "builderforcellm" || normalized.startsWith("builderforcellm/");
    if (isBuilderForceAgentsLlm) {
      const registrationKey =
        process.env.BUILDERFORCE_API_KEY?.trim() ||
        readSharedEnvVar("BUILDERFORCE_API_KEY")?.trim();
      if (!registrationKey) {
        chatLog.addSystem(
          "builderforcellm requires Builderforce registration. Launching setup wizard...",
        );
        if (onSetup) {
          tui.requestRender();
          await onSetup();
          return "onboarding";
        }
        throw new Error("builderforcellm requires Builderforce registration. Run: builderforce onboard");
      }
    }

    // Step 1: Always run `builderforce models set` first. This is the canonical way
    // to change models — it updates the default in config AND adds the model to
    // the allowlist. Without this, `sessions.patch` will reject models that
    // aren't already in the allowlist.
    chatLog.addSystem(`setting default model to ${model}...`);
    logDebug(`[tui-model] patchSessionModel: running "models set ${model}"`);
    const setResult = await runCliCommand(["models", "set", model]);
    if (!setResult.ok) {
      const detail = setResult.lines.join(" | ");
      logWarn(`[tui-model] models set FAILED: ${detail || "unknown error"}`);
      throw new Error(`failed to set model: ${detail || "unknown error"}`);
    }
    logDebug(`[tui-model] models set OK: ${setResult.lines.join(" | ")}`);

    // Step 2: Immediately update the TUI footer to show the new model.
    // Parse provider/model from the input string (first segment is provider).
    const firstSlash = model.indexOf("/");
    if (firstSlash !== -1) {
      state.sessionInfo.modelProvider = model.slice(0, firstSlash);
      state.sessionInfo.model = model.slice(firstSlash + 1);
    } else {
      state.sessionInfo.model = model;
    }
    logDebug(
      `[tui-model] state updated: modelProvider=${state.sessionInfo.modelProvider} model=${state.sessionInfo.model}`,
    );
    updateFooter?.();
    tui.requestRender();

    // Step 3: Patch the session store to clear stale runtime model fields and
    // override. By sending model=null we tell the gateway to reset the session
    // to "use config default" — which `models set` already updated. This avoids
    // allowlist validation entirely and never fails.
    // We still retry because the gateway might briefly be unreachable.
    void (async () => {
      const delays = [500, 2000, 5000, 10000];
      for (let attempt = 0; attempt < delays.length; attempt++) {
        const delay = delays[attempt];
        logDebug(
          `[tui-model] background sessions.patch(model=null) attempt ${attempt + 1}/${delays.length} — waiting ${delay}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        try {
          logDebug(
            `[tui-model] background sessions.patch(model=null) attempt ${attempt + 1}/${delays.length} — sending patch key="${state.currentSessionKey}"`,
          );
          const result = await client.patchSession({
            key: state.currentSessionKey,
            model: null,
          });
          logDebug(
            `[tui-model] background sessions.patch(model=null) attempt ${attempt + 1}/${delays.length} — SUCCESS resolved=${result.resolved?.modelProvider}/${result.resolved?.model}`,
          );
          // Don't applySessionInfoFromPatch here — we already set the correct
          // state in step 2. The patch result may resolve to a stale default
          // if the gateway's config cache hasn't expired yet.
          return;
        } catch (err) {
          logWarn(
            `[tui-model] background sessions.patch(model=null) attempt ${attempt + 1}/${delays.length} — FAILED: ${String(err)}`,
          );
        }
      }
      logWarn(
        `[tui-model] background sessions.patch(model=null): all ${delays.length} retries exhausted`,
      );
    })();
    return "updated";
  };

  const setAgent = async (id: string) => {
    state.currentAgentId = normalizeAgentId(id);
    await setSession("");
  };

  const openModelSelector = async () => {
    try {
      const models = await client.listModels();
      const hasBuilderForceAgentsllm = models.some(
        (model) => model.provider === "builderforcellm" && model.id === "auto",
      );
      if (!hasBuilderForceAgentsllm) {
        models.unshift({
          provider: "builderforcellm",
          id: "auto",
          name: "BuilderForceAgentsLLM Auto (free pool)",
        });
      }
      if (models.length === 0) {
        chatLog.addSystem("no models available");
        tui.requestRender();
        return;
      }
      const items = models.map((model) => ({
        value: `${model.provider}/${model.id}`,
        label: `${model.provider}/${model.id}`,
        description: model.name && model.name !== model.id ? model.name : "",
      }));
      const selector = createSearchableSelectList(items, 9);
      selector.onSelect = (item) => {
        void (async () => {
          try {
            const outcome = await patchSessionModel(item.value);
            if (outcome === "updated") {
              chatLog.addSystem(`model set to ${item.value}`);
            }
          } catch (err) {
            chatLog.addSystem(`model set failed: ${formatModelSetError(err)}`);
          }
          closeOverlay();
          tui.requestRender();
        })();
      };
      selector.onCancel = () => {
        closeOverlay();
        tui.requestRender();
      };
      openOverlay(selector);
      tui.requestRender();
    } catch (err) {
      chatLog.addSystem(`model list failed: ${String(err)}`);
      tui.requestRender();
    }
  };

  const openAgentSelector = async () => {
    await refreshAgents();
    if (state.agents.length === 0) {
      chatLog.addSystem("no agents found");
      tui.requestRender();
      return;
    }
    const items = state.agents.map((agent: AgentSummary) => ({
      value: agent.id,
      label: agent.name ? `${agent.id} (${agent.name})` : agent.id,
      description: agent.id === state.agentDefaultId ? "default" : "",
    }));
    const selector = createSearchableSelectList(items, 9);
    selector.onSelect = (item) => {
      void (async () => {
        closeOverlay();
        await setAgent(item.value);
        tui.requestRender();
      })();
    };
    selector.onCancel = () => {
      closeOverlay();
      tui.requestRender();
    };
    openOverlay(selector);
    tui.requestRender();
  };

  const openSessionSelector = async () => {
    try {
      const result = await client.listSessions({
        includeGlobal: false,
        includeUnknown: false,
        includeDerivedTitles: true,
        includeLastMessage: true,
        agentId: state.currentAgentId,
      });
      const items = result.sessions.map((session) => {
        const title = session.derivedTitle ?? session.displayName;
        const formattedKey = formatSessionKey(session.key);
        // Avoid redundant "title (key)" when title matches key
        const label = title && title !== formattedKey ? `${title} (${formattedKey})` : formattedKey;
        // Build description: time + message preview
        const timePart = session.updatedAt
          ? formatRelativeTimestamp(session.updatedAt, { dateFallback: true, fallback: "" })
          : "";
        const preview = session.lastMessagePreview?.replace(/\s+/g, " ").trim();
        const description =
          timePart && preview ? `${timePart} · ${preview}` : (preview ?? timePart);
        return {
          value: session.key,
          label,
          description,
          searchText: [
            session.displayName,
            session.label,
            session.subject,
            session.sessionId,
            session.key,
            session.lastMessagePreview,
          ]
            .filter(Boolean)
            .join(" "),
        };
      });
      const selector = createFilterableSelectList(items, 9);
      selector.onSelect = (item) => {
        void (async () => {
          closeOverlay();
          await setSession(item.value);
          tui.requestRender();
        })();
      };
      selector.onCancel = () => {
        closeOverlay();
        tui.requestRender();
      };
      openOverlay(selector);
      tui.requestRender();
    } catch (err) {
      chatLog.addSystem(`sessions list failed: ${String(err)}`);
      tui.requestRender();
    }
  };

  const openSettings = () => {
    const items = [
      {
        id: "tools",
        label: "Tool output",
        currentValue: state.toolsExpanded ? "expanded" : "collapsed",
        values: ["collapsed", "expanded"],
      },
      {
        id: "thinking",
        label: "Show thinking",
        currentValue: state.showThinking ? "on" : "off",
        values: ["off", "on"],
      },
      {
        id: "logging",
        label: "File logging",
        currentValue: state.loggingEnabled ? "on" : "off",
        values: ["off", "on"],
      },
    ];
    const settings = createSettingsList(
      items,
      (id, value) => {
        if (id === "tools") {
          state.toolsExpanded = value === "expanded";
          chatLog.setToolsExpanded(state.toolsExpanded);
        }
        if (id === "thinking") {
          state.showThinking = value === "on";
          void loadHistory();
        }
        if (id === "logging") {
          const enabled = value === "on";
          state.loggingEnabled = enabled;
          // persist change asynchronously
          void (async () => {
            try {
              const cfg = loadConfig();
              const updated: BuilderForceAgentsConfig = {
                ...cfg,
                logging: { ...cfg.logging, enabled },
              };
              await writeConfigFile(updated);
              if (context.config) {
                context.config.logging = { ...context.config.logging, enabled };
              }
            } catch (err) {
              chatLog.addSystem(
                `Failed to update config: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          })();
        }
        tui.requestRender();
      },
      () => {
        closeOverlay();
        tui.requestRender();
      },
    );
    openOverlay(settings);
    tui.requestRender();
  };

  const handleCommand = async (raw: string) => {
    const { name, args } = parseCommand(raw);
    if (!name) {
      return;
    }
    switch (name) {
      case "help":
        chatLog.addSystem(
          helpText({
            provider: state.sessionInfo.modelProvider,
            model: state.sessionInfo.model,
          }),
        );
        break;
      case "status":
        try {
          const status = await client.getStatus();
          if (typeof status === "string") {
            chatLog.addSystem(status);
            break;
          }
          if (status && typeof status === "object") {
            const lines = formatStatusSummary(status as GatewayStatusSummary);
            for (const line of lines) {
              chatLog.addSystem(line);
            }
            break;
          }
          chatLog.addSystem("status: unknown response");
        } catch (err) {
          chatLog.addSystem(`status failed: ${String(err)}`);
        }
        break;
      case "agent":
        if (!args) {
          await openAgentSelector();
        } else {
          await setAgent(args);
        }
        break;
      case "agents":
        await openAgentSelector();
        break;
      case "session":
        if (!args) {
          await openSessionSelector();
        } else {
          await setSession(args);
        }
        break;
      case "sessions":
        await openSessionSelector();
        break;
      case "model":
        if (!args) {
          await openModelSelector();
        } else {
          try {
            const outcome = await patchSessionModel(args);
            if (outcome === "updated") {
              chatLog.addSystem(`model set to ${args}`);
            }
          } catch (err) {
            chatLog.addSystem(`model set failed: ${formatModelSetError(err)}`);
          }
        }
        break;
      case "models":
        await openModelSelector();
        break;
      case "think":
        if (!args) {
          const levels = formatThinkingLevels(
            state.sessionInfo.modelProvider,
            state.sessionInfo.model,
            "|",
          );
          chatLog.addSystem(`usage: /think <${levels}>`);
          break;
        }
        try {
          const result = await client.patchSession({
            key: state.currentSessionKey,
            thinkingLevel: args,
          });
          chatLog.addSystem(`thinking set to ${args}`);
          applySessionInfoFromPatch(result);
          await refreshSessionInfo();
        } catch (err) {
          chatLog.addSystem(`think failed: ${String(err)}`);
        }
        break;
      case "verbose":
        if (!args) {
          chatLog.addSystem("usage: /verbose <on|off>");
          break;
        }
        try {
          const result = await client.patchSession({
            key: state.currentSessionKey,
            verboseLevel: args,
          });
          chatLog.addSystem(`verbose set to ${args}`);
          applySessionInfoFromPatch(result);
          await loadHistory();
        } catch (err) {
          chatLog.addSystem(`verbose failed: ${String(err)}`);
        }
        break;
      case "reasoning":
        if (!args) {
          chatLog.addSystem("usage: /reasoning <on|off>");
          break;
        }
        try {
          const result = await client.patchSession({
            key: state.currentSessionKey,
            reasoningLevel: args,
          });
          chatLog.addSystem(`reasoning set to ${args}`);
          applySessionInfoFromPatch(result);
          await refreshSessionInfo();
        } catch (err) {
          chatLog.addSystem(`reasoning failed: ${String(err)}`);
        }
        break;
      case "usage": {
        const normalized = args ? normalizeUsageDisplay(args) : undefined;
        if (args && !normalized) {
          chatLog.addSystem("usage: /usage <off|tokens|full>");
          break;
        }
        const currentRaw = state.sessionInfo.responseUsage;
        const current = resolveResponseUsageMode(currentRaw);
        const next =
          normalized ?? (current === "off" ? "tokens" : current === "tokens" ? "full" : "off");
        try {
          const result = await client.patchSession({
            key: state.currentSessionKey,
            responseUsage: next === "off" ? null : next,
          });
          chatLog.addSystem(`usage footer: ${next}`);
          applySessionInfoFromPatch(result);
          await refreshSessionInfo();
        } catch (err) {
          chatLog.addSystem(`usage failed: ${String(err)}`);
        }
        break;
      }
      case "elevated":
        if (!args) {
          chatLog.addSystem("usage: /elevated <on|off|ask|full>");
          break;
        }
        if (!["on", "off", "ask", "full"].includes(args)) {
          chatLog.addSystem("usage: /elevated <on|off|ask|full>");
          break;
        }
        try {
          const result = await client.patchSession({
            key: state.currentSessionKey,
            elevatedLevel: args,
          });
          chatLog.addSystem(`elevated set to ${args}`);
          applySessionInfoFromPatch(result);
          await refreshSessionInfo();
        } catch (err) {
          chatLog.addSystem(`elevated failed: ${String(err)}`);
        }
        break;
      case "activation":
        if (!args) {
          chatLog.addSystem("usage: /activation <mention|always>");
          break;
        }
        try {
          const result = await client.patchSession({
            key: state.currentSessionKey,
            groupActivation: args === "always" ? "always" : "mention",
          });
          chatLog.addSystem(`activation set to ${args}`);
          applySessionInfoFromPatch(result);
          await refreshSessionInfo();
        } catch (err) {
          chatLog.addSystem(`activation failed: ${String(err)}`);
        }
        break;
      case "new":
      case "reset":
        try {
          // Auto-checkpoint if the session has had user activity, then hint about /handoff for a richer summary
          if (state.isConnected && chatLog.hasUserMessages()) {
            await autoCheckpointSession(chatLog);
            chatLog.addSystem(
              "Session auto-checkpointed. Run /handoff for a full AI-generated summary.",
            );
            tui.requestRender();
          }

          // Clear token counts immediately to avoid stale display (#1523)
          state.sessionInfo.inputTokens = null;
          state.sessionInfo.outputTokens = null;
          state.sessionInfo.totalTokens = null;
          tui.requestRender();

          await client.resetSession(state.currentSessionKey, name);
          chatLog.addSystem(`session ${state.currentSessionKey} reset`);
          await loadHistory();
        } catch (err) {
          chatLog.addSystem(`reset failed: ${String(err)}`);
        }
        break;
      case "abort":
        await abortActive();
        break;
      case "settings":
        openSettings();
        break;
      case "restart": {
        // Restart is a local recovery/control action and must not depend on
        // the current gateway connection state.
        chatLog.addSystem("Running: builderforce gateway restart");
        tui.requestRender();
        const result = await runServiceCommand("restart");
        if (result.lines.length > 0) {
          for (const line of result.lines) {
            chatLog.addSystem(line);
          }
        }
        if (!result.ok) {
          chatLog.addSystem("gateway restart failed");
        } else {
          chatLog.addSystem("Gateway restart started. Reconnecting when it is up…");
        }
        break;
      }
      case "gateway":
      case "daemon": {
        const parts = args.trim().split(/\s+/);
        const actionRaw = parts[0]?.toLowerCase() ?? "";
        if (!actionRaw) {
          chatLog.addSystem("usage: /gateway <status|start|stop|restart|token <value>>");
          break;
        }
        if (actionRaw === "token") {
          const tokenValue = parts.slice(1).join(" ").trim();
          if (!tokenValue) {
            chatLog.addSystem(
              "usage: /gateway token <value> — set gateway.auth.token and sync to service",
            );
            chatLog.addSystem(
              "Use when you see 'Config token differs from service token'. Run /gateway restart after.",
            );
            break;
          }
          try {
            chatLog.addSystem("Setting gateway token and syncing to service…");
            tui.requestRender();
            const cfg = loadConfig();
            const updated: BuilderForceAgentsConfig = {
              ...cfg,
              gateway: {
                ...cfg.gateway,
                auth: {
                  ...cfg.gateway?.auth,
                  mode: "token",
                  token: tokenValue,
                },
              },
            };
            await writeConfigFile(updated);
            if (context.config) {
              context.config.gateway = updated.gateway;
            }
            const installResult = await runCliCommand(["gateway", "install", "--force"]);
            if (installResult.ok) {
              chatLog.addSystem("Gateway token updated and synced to service.");
              chatLog.addSystem("Run /gateway restart to apply.");
            } else {
              chatLog.addSystem("Token saved to config; sync failed:");
              for (const line of installResult.lines) {
                chatLog.addSystem(line);
              }
              const errText = installResult.lines.join(" ").toLowerCase();
              if (errText.includes("access is denied") || errText.includes("administrator")) {
                chatLog.addSystem(
                  "To sync: run PowerShell as Administrator, then: builderforce gateway install --force",
                );
              }
              chatLog.addSystem(
                "Run /gateway restart after syncing (or if gateway runs in foreground).",
              );
            }
          } catch (err) {
            chatLog.addSystem(
              `gateway token failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          break;
        }
        if (!["status", "start", "stop", "restart"].includes(actionRaw)) {
          chatLog.addSystem("usage: /gateway <status|start|stop|restart|token <value>>");
          break;
        }
        const action = actionRaw as "status" | "start" | "stop" | "restart";
        chatLog.addSystem(`running: builderforce gateway ${action}`);
        tui.requestRender();
        const result = await runServiceCommand(action);
        if (result.lines.length > 0) {
          for (const line of result.lines) {
            chatLog.addSystem(line);
          }
        }
        if (!result.ok) {
          chatLog.addSystem(`gateway ${action} failed`);
        }
        break;
      }
      case "logs": {
        const limit = args ? Number.parseInt(args, 10) : 50;
        const count = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : 50;
        try {
          chatLog.addSystem(`fetching last ${count} log lines…`);
          tui.requestRender();
          const result = await client.fetchLogs({ limit: count });
          if (result.file) {
            chatLog.addSystem(`log file: ${result.file}`);
          }
          if (result.lines.length === 0) {
            chatLog.addSystem("(no log lines)");
          } else {
            for (const line of result.lines) {
              chatLog.addSystem(line);
            }
          }
        } catch (err) {
          chatLog.addSystem(`logs failed: ${String(err)}`);
        }
        break;
      }
      case "exit":
      case "quit":
        await autoCheckpointSession(chatLog);
        client.stop();
        tui.stop();
        process.exit(0);
        break;
      case "setup":
        if (onSetup) {
          chatLog.addSystem("Launching setup wizard — TUI will restart when complete.");
          tui.requestRender();
          await onSetup();
        } else {
          chatLog.addSystem("Run: builderforce onboard");
        }
        break;
      case "init":
        try {
          chatLog.addSystem("Initializing builderForceAgents project...");
          tui.requestRender();
          const projectRoot = process.cwd();
          await initializeBuilderForceAgentsProject(projectRoot);
          chatLog.addSystem("✓ builderForceAgents project initialized in .builderforce/");
          chatLog.addSystem("  context.yaml – project metadata");
          chatLog.addSystem("  architecture.md – design documentation");
          chatLog.addSystem("  rules.yaml – coding standards");
          chatLog.addSystem("Running deep codebase understanding to update project files...");
          if (state.isConnected) {
            await sendMessage(
              [
                "Initialize this project by reviewing the current repository and updating these files with accurate, concrete project context:",
                "- .builderforce/context.yaml",
                "- .builderforce/architecture.md",
                "- .builderforce/rules.yaml",
                "",
                "Use Deep Codebase Understanding:",
                "- AST parsing",
                "- semantic maps",
                "- dependency graphs",
                "- git history",
                "",
                "If required details are ambiguous, ask concise wizard-style follow-up questions before finalizing file updates.",
              ].join("\n"),
            );
          } else {
            chatLog.addSystem(
              "Gateway is disconnected. Reconnect and run /init again to auto-populate .builderForceAgents files with AI.",
            );
          }
        } catch (err) {
          chatLog.addSystem(
            `Failed to initialize project: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        break;
      case "handoff":
        if (!state.isConnected) {
          chatLog.addSystem("Gateway is disconnected. Reconnect to save a session handoff.");
          break;
        }
        await sendMessage(
          [
            "Please save a session handoff document for this session using the save_session_handoff tool.",
            `Use projectRoot: ${process.cwd()}`,
            "Include:",
            "- summary: a concise one-paragraph summary of what was accomplished",
            "- decisions: key architectural or design decisions made",
            "- nextSteps: concrete next steps for the following session",
            "- openQuestions: any unresolved questions or blockers",
            "- artifacts: files or documents created or significantly modified",
          ].join("\n"),
        );
        break;
      case "project": {
        const projectRoot = process.cwd();
        const ctx = await loadProjectContext(projectRoot).catch(() => null);
        const ws = await loadWorkspaceState(projectRoot).catch(() => null);
        if (!ctx) {
          chatLog.addSystem("No .builderforce/context.yaml found. Run /init to initialize a project.");
          break;
        }
        const lines: string[] = [
          `Project: ${ctx.projectName ?? "(unnamed)"}`,
          ...(ctx.description ? [`Description: ${ctx.description}`] : []),
          ...(ctx.languages?.length ? [`Languages: ${ctx.languages.join(", ")}`] : []),
          ...(ctx.frameworks?.length ? [`Frameworks: ${ctx.frameworks.join(", ")}`] : []),
        ];
        if (ctx.builderforce) {
          lines.push(
            `Builderforce: instance ${ctx.builderforce.instanceId ?? "?"} (${ctx.builderforce.instanceSlug ?? "?"}) · tenant ${ctx.builderforce.tenantId ?? "?"}`,
          );
        }
        if (ws?.lastSyncedAt) {
          lines.push(
            `Last synced: ${new Date(ws.lastSyncedAt).toLocaleString()} (${ws.syncCount ?? 1} total)`,
          );
        } else {
          lines.push("Last synced: never");
        }
        chatLog.addSystem(lines.join("\n"));
        break;
      }
      case "sync": {
        const projectRoot = process.cwd();
        const apiKey = readSharedEnvVar("BUILDERFORCE_API_KEY")?.trim();
        const baseUrl = normalizeBaseUrl(
          readSharedEnvVar("BUILDERFORCE_URL") ?? "https://api.builderforce.ai",
        );
        if (!apiKey) {
          chatLog.addSystem(
            "Not linked to Builderforce (BUILDERFORCE_API_KEY not set). Run /setup to configure.",
          );
          break;
        }
        const ctx = await loadProjectContext(projectRoot).catch(() => null);
        const agentNodeId = ctx?.builderforce?.instanceId?.trim();
        if (!agentNodeId) {
          chatLog.addSystem(
            "No builderforce.instanceId in .builderforce/context.yaml. Run /init or configure Builderforce first.",
          );
          break;
        }
        chatLog.addSystem("Syncing .builderForceAgents directory to Builderforce…");
        tui.requestRender();
        try {
          const projectId = ctx?.builderforce?.projectId
            ? Number(ctx.builderforce.projectId)
            : undefined;
          const { fileCount } = await syncBuilderForceAgentsDirectoryWithMetaUpdate({
            workspaceDir: projectRoot,
            apiKey,
            baseUrl,
            agentNodeId,
            projectId,
            triggeredBy: "manual",
          });
          chatLog.addSystem(
            `Synced ${fileCount} file${fileCount === 1 ? "" : "s"} to Builderforce.`,
          );
        } catch (err) {
          chatLog.addSystem(`Sync failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        break;
      }
      case "compact":
        // Explicit handler for /compact: forwards to gateway which interprets it
        // as a compaction command. Passing raw preserves any extra instructions.
        await sendMessage(raw);
        break;
      case "spec": {
        const goal = args.trim();
        if (!goal) {
          chatLog.addSystem(
            "Usage: /spec <goal>\nExample: /spec Add real-time collaboration feature",
          );
          break;
        }
        if (!state.isConnected) {
          chatLog.addSystem("Gateway is disconnected. Reconnect to start a spec workflow.");
          break;
        }
        await sendMessage(
          [
            `Please run a spec-driven planning workflow for the following goal: ${goal}`,
            "",
            "Use the orchestrate tool with workflow type 'planning' to produce:",
            "1. A Product Requirements Document (PRD)",
            "2. A detailed architecture specification",
            "3. An ordered task list with dependencies",
            "",
            "Save all outputs to .builderforce/planning/ when complete.",
          ].join("\n"),
        );
        break;
      }
      case "workflow": {
        const workflowId = args.trim();
        if (!state.isConnected) {
          chatLog.addSystem("Gateway is disconnected. Reconnect to check workflow status.");
          break;
        }
        await sendMessage(
          workflowId
            ? `Please check the status of workflow ${workflowId} using the workflow_status tool and report the results.`
            : "Please check the status of the latest workflow using the workflow_status tool and report the results.",
        );
        break;
      }
      case "diff": {
        const target = args.trim();
        if (!hasStagedEdits()) {
          chatLog.addSystem(
            "No staged changes. Agent edits are applied immediately by default.\nRun BUILDERFORCE_AGENTS_STAGED=true or set staged mode to buffer edits for review.",
          );
          break;
        }
        if (target) {
          const edit = getStagedEdit(target);
          if (!edit) {
            chatLog.addSystem(`No staged edit found for: ${target}\n\n${buildStagedSummary()}`);
            break;
          }
          chatLog.addSystem(
            `Diff for ${edit.filePath}:\n\n\`\`\`diff\n${buildUnifiedDiff(edit)}\n\`\`\``,
          );
        } else {
          const edits = getStagedEdits();
          const diffs = edits.map(
            (e) => `### ${e.filePath}\n\`\`\`diff\n${buildUnifiedDiff(e)}\n\`\`\``,
          );
          chatLog.addSystem([buildStagedSummary(), "", ...diffs].join("\n"));
        }
        break;
      }
      case "accept": {
        const target = args.trim().toLowerCase();
        if (!hasStagedEdits()) {
          chatLog.addSystem("No staged changes to accept.");
          break;
        }
        if (!target || target === "all") {
          const { accepted, failed } = await acceptAllEdits();
          const lines: string[] = [];
          if (accepted.length > 0) {
            lines.push(
              `✅ Applied ${accepted.length} change(s):\n${accepted.map((f) => `  ${f}`).join("\n")}`,
            );
          }
          if (failed.length > 0) {
            lines.push(
              `❌ Failed:\n${failed.map((f) => `  ${f.filePath}: ${f.error}`).join("\n")}`,
            );
          }
          chatLog.addSystem(lines.join("\n\n") || "Done.");
        } else {
          const result = await acceptEdit(target);
          if (result.accepted) {
            chatLog.addSystem(`✅ Applied: ${result.filePath}`);
          } else {
            chatLog.addSystem(`❌ Failed: ${result.error ?? "unknown error"}`);
          }
        }
        break;
      }
      case "reject": {
        const target = args.trim().toLowerCase();
        if (!hasStagedEdits()) {
          chatLog.addSystem("No staged changes to reject.");
          break;
        }
        if (!target || target === "all") {
          const { rejected } = rejectAllEdits();
          chatLog.addSystem(`🗑️ Discarded ${rejected.length} staged change(s).`);
        } else {
          const result = rejectEdit(target);
          if (result.rejected) {
            chatLog.addSystem(`🗑️ Discarded staged edit for: ${result.filePath}`);
          } else {
            chatLog.addSystem(`No staged edit found for: ${target}\n\n${buildStagedSummary()}`);
          }
        }
        break;
      }
      case "localbrain": {
        const action = args.trim().toLowerCase();
        const LOCALBRAIN_ACTIONS = ["on", "off", "refresh", "reset"];
        if (action && !LOCALBRAIN_ACTIONS.includes(action)) {
          chatLog.addSystem("usage: /localbrain <on|off|refresh|reset>");
          break;
        }

        // Status (no args)
        if (!action) {
          const cfg = loadConfig();
          const enabled =
            cfg.localBrain?.enabled !== false &&
            Boolean(cfg.models?.providers?.["builderforcellm-local"]);
          const amygdala = cfg.localBrain?.models?.amygdala?.modelId ?? "(not configured)";
          const hippocampus = cfg.localBrain?.models?.hippocampus?.modelId ?? "(not configured)";
          chatLog.addSystem(
            [
              `Local brain: ${enabled ? "on" : "off"}`,
              `  amygdala: ${amygdala}`,
              `  hippocampus: ${hippocampus}`,
              "",
              "Commands: /localbrain <on|off|refresh|reset>",
            ].join("\n"),
          );
          break;
        }

        if (action === "off") {
          try {
            const cfg = loadConfig();
            // Restore the cortex (fallback) model as primary when disabling
            // the local brain so requests no longer route through the
            // builderforcellm-local provider.
            const localPrefix = `${BUILDERFORCE_AGENTSLLM_LOCAL_PROVIDER_ID}/`;
            const currentPrimary = cfg.agents?.defaults?.model?.primary;
            const fallbacks = cfg.agents?.defaults?.model?.fallbacks ?? [];
            let modelPatch: Record<string, unknown> = {};
            if (currentPrimary?.startsWith(localPrefix)) {
              const newPrimary = fallbacks.find((f) => !f.startsWith(localPrefix));
              const newFallbacks = fallbacks.filter(
                (f) => f !== newPrimary && !f.startsWith(localPrefix),
              );
              if (newPrimary) {
                modelPatch = {
                  agents: {
                    ...cfg.agents,
                    defaults: {
                      ...cfg.agents?.defaults,
                      model:
                        newFallbacks.length > 0
                          ? { primary: newPrimary, fallbacks: newFallbacks }
                          : { primary: newPrimary },
                    },
                  },
                };
              }
            }
            const updated: BuilderForceAgentsConfig = {
              ...cfg,
              ...modelPatch,
              localBrain: { ...cfg.localBrain, enabled: false },
            };
            await writeConfigFile(updated);
            if (context.config) {
              context.config.localBrain = { ...context.config.localBrain, enabled: false };
            }
            chatLog.addSystem("Local brain disabled.");
            chatLog.addSystem("The cortex (your configured LLM) will handle all requests.");
            updateFooter?.();
          } catch (err) {
            chatLog.addSystem(
              `Failed to update config: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          break;
        }

        if (action === "on") {
          try {
            let cfg = loadConfig();
            const cacheDir = defaultCacheDir();
            // Always use the built-in defaults — stale model IDs in config
            // (e.g. from a previous release) must not override the current
            // recommended models.
            const amygdalaModelId = AMYGDALA_MODEL_ID;
            const amygdalaDtype = AMYGDALA_DTYPE;
            const hippocampusModelId = HIPPOCAMPUS_MODEL_ID;
            const hippocampusDtype = HIPPOCAMPUS_DTYPE;

            const amygdalaCached = await isModelCached(cacheDir, amygdalaModelId);
            const hippocampusCached = await isModelCached(cacheDir, hippocampusModelId);

            if (!amygdalaCached || !hippocampusCached) {
              chatLog.addSystem(
                "Some local brain models are missing — downloading… (~3.5 GB total: amygdala + hippocampus)",
              );
              tui.requestRender();
            }

            if (!amygdalaCached) {
              chatLog.addSystem(`Downloading amygdala (${amygdalaModelId}, ${amygdalaDtype})…`);
              tui.requestRender();
              try {
                await downloadBuilderForceAgentsLlmModel({
                  modelId: amygdalaModelId,
                  dtype: amygdalaDtype,
                  cacheDir,
                  onProgress: (_file, pct) => {
                    setActivityStatus(`Amygdala: ${pct}%`);
                    tui.requestRender();
                  },
                });
                setActivityStatus("");
                chatLog.addSystem("Amygdala downloaded.");
              } catch (err) {
                setActivityStatus("");
                chatLog.addSystem(
                  `Amygdala download failed: ${err instanceof Error ? err.message : String(err)}`,
                );
              }
            }

            if (!hippocampusCached) {
              chatLog.addSystem(
                `Downloading hippocampus (${hippocampusModelId}, ${hippocampusDtype})…`,
              );
              tui.requestRender();
              try {
                await downloadBuilderForceAgentsLlmModel({
                  modelId: hippocampusModelId,
                  dtype: hippocampusDtype,
                  cacheDir,
                  onProgress: (_file, pct) => {
                    setActivityStatus(`Hippocampus: ${pct}%`);
                    tui.requestRender();
                  },
                });
                setActivityStatus("");
                chatLog.addSystem("Hippocampus downloaded.");
              } catch (err) {
                setActivityStatus("");
                chatLog.addSystem(
                  `Hippocampus download failed: ${err instanceof Error ? err.message : String(err)}`,
                );
              }
            }

            // Ensure provider config is wired up.
            const hasProvider = Boolean(cfg.models?.providers?.["builderforcellm-local"]);
            if (!hasProvider || !amygdalaCached || !hippocampusCached) {
              cfg = applyTransformersProviderConfig(
                cfg,
                amygdalaModelId,
                amygdalaDtype,
                hippocampusModelId,
                hippocampusDtype,
                cacheDir,
              );
            }

            // Set the primary model to the local brain entry so that
            // resolveModel() yields api:"transformers" and the local-brain
            // gate in attempt.ts activates.  The existing primary becomes the
            // first fallback (the cortex used for DELEGATE).
            const localModelKey = `${BUILDERFORCE_AGENTSLLM_LOCAL_PROVIDER_ID}/${amygdalaModelId}`;
            const existingPrimary = cfg.agents?.defaults?.model?.primary;
            const existingFallbacks = cfg.agents?.defaults?.model?.fallbacks ?? [];
            if (existingPrimary && existingPrimary !== localModelKey) {
              cfg = {
                ...cfg,
                agents: {
                  ...cfg.agents,
                  defaults: {
                    ...cfg.agents?.defaults,
                    model: {
                      primary: localModelKey,
                      fallbacks: [
                        existingPrimary,
                        ...existingFallbacks.filter((f) => f !== localModelKey),
                      ],
                    },
                  },
                },
              };
            } else if (!existingPrimary) {
              cfg = {
                ...cfg,
                agents: {
                  ...cfg.agents,
                  defaults: {
                    ...cfg.agents?.defaults,
                    model: {
                      primary: localModelKey,
                      fallbacks: existingFallbacks.filter((f) => f !== localModelKey),
                    },
                  },
                },
              };
            }

            const updated: BuilderForceAgentsConfig = {
              ...cfg,
              localBrain: {
                ...cfg.localBrain,
                enabled: true,
                models: {
                  amygdala: { modelId: amygdalaModelId, dtype: amygdalaDtype },
                  hippocampus: { modelId: hippocampusModelId, dtype: hippocampusDtype },
                },
              },
            };
            await writeConfigFile(updated);
            if (context.config) {
              context.config.localBrain = { ...updated.localBrain };
            }
            chatLog.addSystem("Local brain enabled.");
            updateFooter?.();
          } catch (err) {
            chatLog.addSystem(
              `Failed to enable local brain: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          break;
        }

        if (action === "refresh") {
          // Re-download local brain models via the setup wizard.
          if (onSetup) {
            chatLog.addSystem("Launching setup wizard to refresh local brain models…");
            tui.requestRender();
            await onSetup();
          } else {
            chatLog.addSystem(
              "Run: builderforce onboard\nThis will re-download the latest local brain models.",
            );
          }
          break;
        }

        if (action === "reset") {
          try {
            const cfg = loadConfig();
            const { localBrain: _removed, ...rest } = cfg;
            const { ["builderforcellm-local"]: _removedProvider, ...remainingProviders } =
              cfg.models?.providers ?? {};
            const updated: BuilderForceAgentsConfig = {
              ...rest,
              models: {
                ...cfg.models,
                providers: remainingProviders,
              },
            };
            await writeConfigFile(updated);
            if (context.config) {
              delete context.config.localBrain;
            }
            chatLog.addSystem("Local brain config cleared. Models on disk are unchanged.");
            chatLog.addSystem("Run /localbrain on to re-initialize with current defaults.");
            updateFooter?.();
          } catch (err) {
            chatLog.addSystem(
              `Failed to reset local brain config: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          break;
        }
        break;
      }
      default:
        await sendMessage(raw);
        break;
    }
    tui.requestRender();
  };

  const sendMessage = async (text: string) => {
    // Plain-text "setup"/"onboard" fallback: intercept when gateway is not
    // connected so the user doesn't need to remember the slash prefix.
    const lower = text.trim().toLowerCase();
    if (!state.isConnected && (lower === "setup" || lower === "onboard") && onSetup) {
      chatLog.addSystem("Launching setup wizard — TUI will restart when complete.");
      tui.requestRender();
      await onSetup();
      return;
    }
    try {
      chatLog.addUser(text);
      tui.requestRender();
      const runId = randomUUID();
      noteLocalRunId(runId);
      // The gateway broadcasts the user message back with runId
      // `user-${clientRunId}` — note that variant so the dedup guard in
      // tui-event-handlers recognises it and doesn't render the message twice.
      noteLocalRunId(`user-${runId}`);
      state.activeChatRunId = runId;
      setActivityStatus("sending");
      reportAction?.("sending message to gateway");
      await client.sendChat({
        sessionKey: state.currentSessionKey,
        message: text,
        thinking: opts.thinking,
        deliver: deliverDefault,
        timeoutMs: opts.timeoutMs,
        runId,
      });
      setActivityStatus("waiting");
      reportAction?.("waiting for assistant response");
    } catch (err) {
      if (state.activeChatRunId) {
        forgetLocalRunId?.(state.activeChatRunId);
        forgetLocalRunId?.(`user-${state.activeChatRunId}`);
      }
      state.activeChatRunId = null;
      chatLog.addSystem(`send failed: ${String(err)}`);
      setActivityStatus("error");
      reportAction?.("send failed");
    }
    tui.requestRender();
  };

  return {
    handleCommand,
    sendMessage,
    openModelSelector,
    openAgentSelector,
    openSessionSelector,
    openSettings,
    setAgent,
  };
}
