import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "../agents/defaults.js";
import { loadModelCatalog } from "../agents/model-catalog.js";
import {
  getModelRefStatus,
  resolveConfiguredModelRef,
  resolveHooksGmailModel,
} from "../agents/model-selection.js";
import { resolveAgentSessionDirs } from "../agents/session-dirs.js";
import { cleanStaleLockFiles } from "../agents/session-write-lock.js";
import type { CliDeps } from "../cli/deps.js";
import { registerPlatformPersonasAsRoles } from "../builderforce/agent-roles.js";
import { globalOrchestrator } from "../builderforce/orchestrator.js";
import { loadProjectContext } from "../builderforce/project-context.js";
import type { loadConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import { startGmailWatcherWithLogs } from "../hooks/gmail-watcher-lifecycle.js";
import {
  clearInternalHooks,
  createInternalHookEvent,
  triggerInternalHook,
} from "../hooks/internal-hooks.js";
import { loadInternalHooks } from "../hooks/loader.js";
import { BuilderforceAgentTransport } from "../infra/agent-transport.js";
import { initApprovalGate } from "../infra/approval-gate.js";
import { syncBuilderForceAgentsDirectoryOnStartup } from "../infra/builderforce-directory-sync.js";
import { BuilderforceRelayService } from "../infra/builderforce-relay.js";
import { CompositeAgentTransport } from "../infra/composite-agent-transport.js";
import { CronPollerService } from "../infra/cron-poller.js";
import { WorkflowPollerService } from "../infra/workflow-poller.js";
import { readSharedEnvVar } from "../infra/env-file.js";
import { isTruthyEnvValue } from "../infra/env.js";
import { KnowledgeLoopService, setKnowledgeLoopService } from "../infra/knowledge-loop.js";
import { LocalAgentTransport } from "../infra/local-agent-transport.js";
import {
  LocalResultBrokerAdapter,
  SsmMemoryAdapter,
  WorkflowTelemetryAdapter,
} from "../infra/orchestrator-ports-adapter.js";
import { fetchPlatformPersonas } from "../infra/platform-persona-sync.js";
import { pushProjectContextToBuilderforce } from "../infra/project-context-push.js";
import { checkAndWarnQuota } from "../infra/quota-monitor.js";
import { fetchAndLoadSkills } from "../infra/skill-registry.js";
import { initSsmMemoryService } from "../infra/ssm-memory-service.js";
import type { loadBuilderForceAgentsPlugins } from "../plugins/loader.js";
import { type PluginServicesHandle, startPluginServices } from "../plugins/services.js";
import { startBrowserControlServerIfEnabled } from "./server-browser.js";
import {
  scheduleRestartSentinelWake,
  shouldWakeFromRestartSentinel,
} from "./server-restart-sentinel.js";
import { startGatewayMemoryBackend } from "./server-startup-memory.js";

const SESSION_LOCK_STALE_MS = 30 * 60 * 1000;

// ── Shared param types ────────────────────────────────────────────────────────

type SidecarParams = {
  cfg: ReturnType<typeof loadConfig>;
  pluginRegistry: ReturnType<typeof loadBuilderForceAgentsPlugins>;
  defaultWorkspaceDir: string;
  deps: CliDeps;
  startChannels: () => Promise<void>;
  log: { warn: (msg: string) => void };
  logHooks: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  logChannels: { info: (msg: string) => void; error: (msg: string) => void };
  logBrowser: { error: (msg: string) => void };
};

// ── Single-responsibility subsystem starters ──────────────────────────────────

/** Remove lock files from sessions that died without releasing their locks. */
async function cleanStaleSessions(
  params: Pick<SidecarParams, "defaultWorkspaceDir" | "log">,
): Promise<void> {
  try {
    const stateDir = resolveStateDir(process.env);
    const sessionDirs = await resolveAgentSessionDirs(stateDir);
    for (const sessionsDir of sessionDirs) {
      await cleanStaleLockFiles({
        sessionsDir,
        staleMs: SESSION_LOCK_STALE_MS,
        removeStale: true,
        log: { warn: (message) => params.log.warn(message) },
      });
    }
  } catch (err) {
    params.log.warn(`session lock cleanup failed on startup: ${String(err)}`);
  }
}

/** Wire orchestrator ports and rehydrate any persisted incomplete workflows. */
async function startOrchestrator(
  params: Pick<SidecarParams, "defaultWorkspaceDir" | "log">,
): Promise<void> {
  globalOrchestrator.setProjectRoot(params.defaultWorkspaceDir);
  // Local transport is always available — in-process subagent spawn works
  // without credentials. The remote transport gets added later (in
  // startBuilderforceServices) when BUILDERFORCE_API_KEY + agentNodeId are present.
  const localResultBroker = new LocalResultBrokerAdapter();
  const localTransport = new LocalAgentTransport({
    getContext: () => globalOrchestrator.currentSpawnContext(),
    localResultBroker,
  });
  globalOrchestrator.configure({
    telemetry: new WorkflowTelemetryAdapter(),
    agentTransport: new CompositeAgentTransport({ local: localTransport }),
  });
  const incompleteWorkflows = await globalOrchestrator.loadPersistedWorkflows();
  if (incompleteWorkflows.length > 0) {
    params.log.warn(
      `[orchestrator] ${incompleteWorkflows.length} incomplete workflow(s) restored: ${incompleteWorkflows.join(", ")}`,
    );
  }
}

/** Start the browser CDP control server (unless disabled by config). */
async function startBrowserControl(
  params: Pick<SidecarParams, "logBrowser">,
): Promise<Awaited<ReturnType<typeof startBrowserControlServerIfEnabled>>> {
  try {
    return await startBrowserControlServerIfEnabled();
  } catch (err) {
    params.logBrowser.error(`server failed to start: ${String(err)}`);
    return null;
  }
}

/** Start the Gmail watcher, validate its model config, and load internal hooks. */
async function startHooks(
  params: Pick<SidecarParams, "cfg" | "defaultWorkspaceDir" | "deps" | "logHooks">,
): Promise<void> {
  await startGmailWatcherWithLogs({ cfg: params.cfg, log: params.logHooks });

  if (params.cfg.hooks?.gmail?.model) {
    const hooksModelRef = resolveHooksGmailModel({
      cfg: params.cfg,
      defaultProvider: DEFAULT_PROVIDER,
    });
    if (hooksModelRef) {
      const { provider: defaultProvider, model: defaultModel } = resolveConfiguredModelRef({
        cfg: params.cfg,
        defaultProvider: DEFAULT_PROVIDER,
        defaultModel: DEFAULT_MODEL,
      });
      const catalog = await loadModelCatalog({ config: params.cfg });
      const status = getModelRefStatus({
        cfg: params.cfg,
        catalog,
        ref: hooksModelRef,
        defaultProvider,
        defaultModel,
      });
      if (!status.allowed) {
        params.logHooks.warn(
          `hooks.gmail.model "${status.key}" not in agents.defaults.models allowlist (will use primary instead)`,
        );
      }
      if (!status.inCatalog) {
        params.logHooks.warn(
          `hooks.gmail.model "${status.key}" not in the model catalog (may fail at runtime)`,
        );
      }
    }
  }

  try {
    clearInternalHooks();
    const loadedCount = await loadInternalHooks(params.cfg, params.defaultWorkspaceDir);
    if (loadedCount > 0) {
      params.logHooks.info(
        `loaded ${loadedCount} internal hook handler${loadedCount > 1 ? "s" : ""}`,
      );
    }
  } catch (err) {
    params.logHooks.error(`failed to load hooks: ${String(err)}`);
  }

  if (params.cfg.hooks?.internal?.enabled) {
    const hookEvent = createInternalHookEvent("gateway", "startup", "gateway:startup", {
      cfg: params.cfg,
      deps: params.deps,
      workspaceDir: params.defaultWorkspaceDir,
    });
    void triggerInternalHook(hookEvent);
  }
}

/** Connect all configured message channels (Telegram, Slack, Discord, …). */
async function startMessageChannels(
  params: Pick<SidecarParams, "startChannels" | "logChannels">,
): Promise<void> {
  const skipChannels =
    isTruthyEnvValue(process.env.BUILDERFORCE_AGENTS_SKIP_CHANNELS) ||
    isTruthyEnvValue(process.env.BUILDERFORCE_AGENTS_SKIP_PROVIDERS);
  if (skipChannels) {
    params.logChannels.info(
      "skipping channel start (BUILDERFORCE_AGENTS_SKIP_CHANNELS=1 or BUILDERFORCE_AGENTS_SKIP_PROVIDERS=1)",
    );
    return;
  }
  try {
    await params.startChannels();
  } catch (err) {
    params.logChannels.error(`channel startup failed: ${String(err)}`);
  }
}

/** Start plugin services declared in the plugin registry. */
async function startPlugins(
  params: Pick<SidecarParams, "cfg" | "pluginRegistry" | "defaultWorkspaceDir" | "log">,
): Promise<PluginServicesHandle | null> {
  try {
    return await startPluginServices({
      registry: params.pluginRegistry,
      config: params.cfg,
      workspaceDir: params.defaultWorkspaceDir,
    });
  } catch (err) {
    params.log.warn(`plugin services failed to start: ${String(err)}`);
    return null;
  }
}

/** Start the QMD memory backend and SSM hippocampus layer. */
function startMemoryBackend(
  params: Pick<SidecarParams, "cfg" | "defaultWorkspaceDir" | "log">,
): void {
  void startGatewayMemoryBackend({ cfg: params.cfg, log: params.log }).catch((err) => {
    params.log.warn(`qmd memory startup initialization failed: ${String(err)}`);
  });

  void initSsmMemoryService({
    checkpointPath: `${params.defaultWorkspaceDir}/.builderforce/model.bin`,
    modelSize: "small",
  })
    .then((svc) => {
      if (svc) {
        params.log.warn(`[ssm-memory] hippocampus layer started (gpu=${svc.gpuAvailable})`);
        globalOrchestrator.configure({ memoryService: new SsmMemoryAdapter() });
      }
    })
    .catch((err) => {
      params.log.warn(`[ssm-memory] startup failed: ${String(err)}`);
    });
}

/**
 * Start Builderforce upstream relay, knowledge loop, cron poller, and all
 * cloud-connected services. No-ops gracefully when BUILDERFORCE_API_KEY is absent.
 */
async function startBuilderforceServices(
  params: Pick<SidecarParams, "cfg" | "defaultWorkspaceDir" | "log">,
): Promise<{ relay: BuilderforceRelayService | null; knowledgeLoop: KnowledgeLoopService | null }> {
  let relay: BuilderforceRelayService | null = null;
  let knowledgeLoop: KnowledgeLoopService | null = null;

  try {
    const apiKey = readSharedEnvVar("BUILDERFORCE_API_KEY");
    const baseUrl = readSharedEnvVar("BUILDERFORCE_URL") ?? "https://api.builderforce.ai";

    if (!apiKey) {
      params.log.warn(
        "[builderforce] standalone mode — BUILDERFORCE_API_KEY not set; " +
          "Builderforce connection and agent-to-agent dispatch are disabled. " +
          "Set BUILDERFORCE_API_KEY in ~/.builderforce/.env to enable them.",
      );
      return { relay, knowledgeLoop };
    }

    const ctx = await loadProjectContext(params.defaultWorkspaceDir);
    const agentNodeId = ctx?.builderforce?.instanceId;
    const projectId = ctx?.builderforce?.projectId ? Number(ctx.builderforce.projectId) : undefined;

    if (agentNodeId) {
      globalOrchestrator.setProjectRoot(
        params.defaultWorkspaceDir,
        String(agentNodeId),
        baseUrl,
        apiKey,
      );
      initApprovalGate({ baseUrl, agentNodeId: String(agentNodeId), apiKey });

      relay = new BuilderforceRelayService({
        baseUrl,
        agentNodeId: String(agentNodeId),
        apiKey,
        workspaceDir: params.defaultWorkspaceDir,
      });
      relay.start();
      params.log.warn(`[builderforce] relay started for agentNode ${agentNodeId}`);
      relay.setRemoteDispatchOptions({ baseUrl, myAgentNodeId: String(agentNodeId), apiKey });

      void fetchPlatformPersonas({ baseUrl, agentNodeId: String(agentNodeId), apiKey }).then((personas) => {
        if (personas.length > 0) {
          params.log.warn(`[platform-personas] loaded ${personas.length} platform persona(s)`);
          registerPlatformPersonasAsRoles(personas);
        }
      });

      void checkAndWarnQuota({ baseUrl, agentNodeId: String(agentNodeId), apiKey });

      void (async () => {
        try {
          if (ctx?.builderforce?.projectId && ctx.description) {
            await pushProjectContextToBuilderforce(
              { baseUrl, agentNodeId: String(agentNodeId), apiKey },
              { projectId: Number(ctx.builderforce.projectId), governance: ctx.description },
            );
          }
        } catch (err) {
          params.log.warn(`[project-context-push] failed: ${String(err)}`);
        }
      })();

      void fetchAndLoadSkills({ baseUrl, agentNodeId: String(agentNodeId), apiKey });

      const cronPoller = new CronPollerService({ baseUrl, agentNodeId: String(agentNodeId), apiKey });
      void cronPoller.start();
      params.log.warn("[cron-poller] started");

      void syncBuilderForceAgentsDirectoryOnStartup({
        workspaceDir: params.defaultWorkspaceDir,
        log: params.log,
      });

      // Upgrade the orchestrator's transport: local stays available, remote
      // gets added now that we have credentials. Re-uses the local broker that
      // startOrchestrator already wired so output collection stays consistent.
      const localResultBroker = new LocalResultBrokerAdapter();
      const localTransport = new LocalAgentTransport({
        getContext: () => globalOrchestrator.currentSpawnContext(),
        localResultBroker,
      });
      const remoteTransport = new BuilderforceAgentTransport({
        baseUrl,
        myAgentNodeId: String(agentNodeId),
        apiKey,
      });
      globalOrchestrator.configure({
        agentTransport: new CompositeAgentTransport({
          local: localTransport,
          remote: remoteTransport,
        }),
        relayService: relay,
      });

      // Execute portal-authored visual workflows assigned to this host. Started
      // after the transport is configured so agent nodes can dispatch.
      const workflowPoller = new WorkflowPollerService({
        baseUrl,
        agentNodeId: String(agentNodeId),
        apiKey,
        getContext: () => globalOrchestrator.currentSpawnContext(),
      });
      workflowPoller.start();
      params.log.warn("[workflow-poller] started");
    }

    knowledgeLoop = new KnowledgeLoopService({
      workspaceDir: params.defaultWorkspaceDir,
      apiKey,
      baseUrl,
      agentNodeId: agentNodeId ? String(agentNodeId) : null,
      projectId,
    });
    knowledgeLoop.start();
    setKnowledgeLoopService(knowledgeLoop);
    params.log.warn("[knowledge-loop] started");
  } catch (err) {
    params.log.warn(`[builderforce/knowledge-loop] startup failed: ${String(err)}`);
  }

  return { relay, knowledgeLoop };
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function startGatewaySidecars(params: SidecarParams) {
  await cleanStaleSessions(params);
  await startOrchestrator(params);
  const browserControl = await startBrowserControl(params);
  await startHooks(params);
  await startMessageChannels(params);
  const pluginServices = await startPlugins(params);
  startMemoryBackend(params);

  if (shouldWakeFromRestartSentinel()) {
    void scheduleRestartSentinelWake({ deps: params.deps });
  }

  const { relay: builderforceRelay, knowledgeLoop } = await startBuilderforceServices(params);

  return { browserControl, pluginServices, builderforceRelay, knowledgeLoop };
}
