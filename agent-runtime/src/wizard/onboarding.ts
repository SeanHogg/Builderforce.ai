import path from "node:path";
import { ensureAuthProfileStore } from "../agents/auth-profiles.js";
import { formatCliCommand } from "../cli/command-format.js";
import type {
  GatewayAuthChoice,
  OnboardMode,
  OnboardOptions,
  ResetScope,
} from "../commands/onboard-types.js";
import type { BuilderForceAgentsConfig } from "../config/config.js";
import {
  DEFAULT_GATEWAY_PORT,
  readConfigFileSnapshot,
  resolveGatewayPort,
  writeConfigFile,
} from "../config/config.js";
import { readSharedEnvVar } from "../infra/env-file.js";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import { resolveUserPath } from "../utils.js";
import type {
  GatewayWizardSettings,
  QuickstartGatewayDefaults,
  WizardFlow,
} from "./onboarding.types.js";
import { WizardCancelledError, type WizardPrompter } from "./prompts.js";

async function requireRiskAcknowledgement(params: {
  opts: OnboardOptions;
  prompter: WizardPrompter;
}) {
  if (params.opts.acceptRisk === true) {
    return;
  }

  await params.prompter.note(
    [
      "Security warning — please read.",
      "",
      "BuilderForceAgents is a hobby project and still in beta. Expect sharp edges.",
      "This bot can read files and run actions if tools are enabled.",
      "A bad prompt can trick it into doing unsafe things.",
      "",
      "If you’re not comfortable with basic security and access control, don’t run BuilderForceAgents.",
      "Ask someone experienced to help before enabling tools or exposing it to the internet.",
      "",
      "Recommended baseline:",
      "- Pairing/allowlists + mention gating.",
      "- Sandbox + least-privilege tools.",
      "- Keep secrets out of the agent’s reachable filesystem.",
      "- Use the strongest available model for any bot with tools or untrusted inboxes.",
      "",
      "Run regularly:",
      "builderforce security audit --deep",
      "builderforce security audit --fix",
      "",
      "Must read: https://docs.builderforce.ai/gateway/security",
    ].join("\n"),
    "Security",
  );

  const ok = await params.prompter.confirm({
    message: "I understand this is powerful and inherently risky. Continue?",
    initialValue: false,
  });
  if (!ok) {
    throw new WizardCancelledError("risk not accepted");
  }
}

function hasConfiguredModelOrAuth(config: BuilderForceAgentsConfig): boolean {
  const defaultsModel = config.agents?.defaults?.model;
  const hasDefaultModel =
    typeof defaultsModel?.primary === "string" && defaultsModel.primary.trim().length > 0;
  const hasModelCatalog =
    Boolean(config.models) && Object.keys(config.models as Record<string, unknown>).length > 0;
  return hasDefaultModel || hasModelCatalog;
}

function hasConfiguredChannels(config: BuilderForceAgentsConfig): boolean {
  const channels = config.channels;
  if (!channels || typeof channels !== "object") {
    return false;
  }
  return Object.values(channels as Record<string, unknown>).some((value) => {
    if (value === null || value === undefined) {
      return false;
    }
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      return value.trim().length > 0;
    }
    if (typeof value === "number") {
      return true;
    }
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    if (typeof value === "object") {
      return Object.keys(value as Record<string, unknown>).length > 0;
    }
    return false;
  });
}

export async function runOnboardingWizard(
  opts: OnboardOptions,
  runtime: RuntimeEnv = defaultRuntime,
  prompter: WizardPrompter,
) {
  const onboardHelpers = await import("../commands/onboard-helpers.js");
  onboardHelpers.printWizardHeader(runtime);
  await prompter.intro("BuilderForceAgents onboarding");
  await requireRiskAcknowledgement({ opts, prompter });

  const snapshot = await readConfigFileSnapshot();
  let baseConfig: BuilderForceAgentsConfig = snapshot.valid ? snapshot.config : {};
  let configHandlingAction: "keep" | "modify" | "reset" | null = null;

  if (snapshot.exists && !snapshot.valid) {
    await prompter.note(onboardHelpers.summarizeExistingConfig(baseConfig), "Invalid config");
    if (snapshot.issues.length > 0) {
      await prompter.note(
        [
          ...snapshot.issues.map((iss) => `- ${iss.path}: ${iss.message}`),
          "",
          "Docs: https://docs.builderforce.ai/gateway/configuration",
        ].join("\n"),
        "Config issues",
      );
    }
    await prompter.outro(
      `Config invalid. Run \`${formatCliCommand("builderforce doctor")}\` to repair it, then re-run onboarding.`,
    );
    runtime.exit(1);
    return;
  }

  const quickstartHint = `Configure details later via ${formatCliCommand("builderforce configure")}.`;
  const manualHint = "Configure port, network, Tailscale, and auth options.";
  const explicitFlowRaw = opts.flow?.trim();
  const normalizedExplicitFlow = explicitFlowRaw === "manual" ? "advanced" : explicitFlowRaw;
  if (
    normalizedExplicitFlow &&
    normalizedExplicitFlow !== "quickstart" &&
    normalizedExplicitFlow !== "advanced"
  ) {
    runtime.error("Invalid --flow (use quickstart, manual, or advanced).");
    runtime.exit(1);
    return;
  }
  const explicitFlow: WizardFlow | undefined =
    normalizedExplicitFlow === "quickstart" || normalizedExplicitFlow === "advanced"
      ? normalizedExplicitFlow
      : undefined;
  let flow: WizardFlow =
    explicitFlow ??
    (await prompter.select({
      message: "Onboarding mode",
      options: [
        { value: "quickstart", label: "QuickStart", hint: quickstartHint },
        { value: "advanced", label: "Manual", hint: manualHint },
      ],
      initialValue: "quickstart",
    }));

  if (opts.mode === "remote" && flow === "quickstart") {
    await prompter.note(
      "QuickStart only supports local gateways. Switching to Manual mode.",
      "QuickStart",
    );
    flow = "advanced";
  }

  if (snapshot.exists) {
    await prompter.note(
      onboardHelpers.summarizeExistingConfig(baseConfig),
      "Existing config detected",
    );

    const action = await prompter.select<"keep" | "modify" | "reset">({
      message: "Config handling\n(↑/↓ to select, Enter to confirm)",
      options: [
        { value: "keep", label: "Use existing values" },
        { value: "modify", label: "Update values" },
        { value: "reset", label: "Reset" },
      ],
      initialValue: "keep",
    });
    configHandlingAction = action;

    if (action === "reset") {
      const workspaceDefault =
        baseConfig.agents?.defaults?.workspace ?? onboardHelpers.DEFAULT_WORKSPACE;
      const resetScope = (await prompter.select({
        message: "Reset scope",
        options: [
          { value: "config", label: "Config only" },
          {
            value: "config+creds+sessions",
            label: "Config + creds + sessions",
          },
          {
            value: "full",
            label: "Full reset (config + creds + sessions + workspace)",
          },
        ],
      })) as ResetScope;
      await onboardHelpers.handleReset(resetScope, resolveUserPath(workspaceDefault), runtime);
      baseConfig = {};
    }
  }

  const keepExistingValues = configHandlingAction === "keep";

  const quickstartGateway: QuickstartGatewayDefaults = (() => {
    const hasExisting =
      typeof baseConfig.gateway?.port === "number" ||
      baseConfig.gateway?.bind !== undefined ||
      baseConfig.gateway?.auth?.mode !== undefined ||
      baseConfig.gateway?.auth?.token !== undefined ||
      baseConfig.gateway?.auth?.password !== undefined ||
      baseConfig.gateway?.customBindHost !== undefined ||
      baseConfig.gateway?.tailscale?.mode !== undefined;

    const bindRaw = baseConfig.gateway?.bind;
    const bind =
      bindRaw === "loopback" ||
      bindRaw === "lan" ||
      bindRaw === "auto" ||
      bindRaw === "custom" ||
      bindRaw === "tailnet"
        ? bindRaw
        : "loopback";

    let authMode: GatewayAuthChoice = "token";
    if (
      baseConfig.gateway?.auth?.mode === "token" ||
      baseConfig.gateway?.auth?.mode === "password"
    ) {
      authMode = baseConfig.gateway.auth.mode;
    } else if (baseConfig.gateway?.auth?.token) {
      authMode = "token";
    } else if (baseConfig.gateway?.auth?.password) {
      authMode = "password";
    }

    const tailscaleRaw = baseConfig.gateway?.tailscale?.mode;
    const tailscaleMode =
      tailscaleRaw === "off" || tailscaleRaw === "serve" || tailscaleRaw === "funnel"
        ? tailscaleRaw
        : "off";

    return {
      hasExisting,
      port: resolveGatewayPort(baseConfig),
      bind,
      authMode,
      tailscaleMode,
      token: baseConfig.gateway?.auth?.token,
      password: baseConfig.gateway?.auth?.password,
      customBindHost: baseConfig.gateway?.customBindHost,
      tailscaleResetOnExit: baseConfig.gateway?.tailscale?.resetOnExit ?? false,
    };
  })();

  if (flow === "quickstart") {
    const formatBind = (value: "loopback" | "lan" | "auto" | "custom" | "tailnet") => {
      if (value === "loopback") {
        return "Loopback (127.0.0.1)";
      }
      if (value === "lan") {
        return "LAN";
      }
      if (value === "custom") {
        return "Custom IP";
      }
      if (value === "tailnet") {
        return "Tailnet (Tailscale IP)";
      }
      return "Auto";
    };
    const formatAuth = (value: GatewayAuthChoice) => {
      if (value === "token") {
        return "Token (default)";
      }
      return "Password";
    };
    const formatTailscale = (value: "off" | "serve" | "funnel") => {
      if (value === "off") {
        return "Off";
      }
      if (value === "serve") {
        return "Serve";
      }
      return "Funnel";
    };
    const quickstartLines = quickstartGateway.hasExisting
      ? [
          "Keeping your current gateway settings:",
          `Gateway port: ${quickstartGateway.port}`,
          `Gateway bind: ${formatBind(quickstartGateway.bind)}`,
          ...(quickstartGateway.bind === "custom" && quickstartGateway.customBindHost
            ? [`Gateway custom IP: ${quickstartGateway.customBindHost}`]
            : []),
          `Gateway auth: ${formatAuth(quickstartGateway.authMode)}`,
          `Tailscale exposure: ${formatTailscale(quickstartGateway.tailscaleMode)}`,
          "Direct to chat channels.",
        ]
      : [
          `Gateway port: ${DEFAULT_GATEWAY_PORT}`,
          "Gateway bind: Loopback (127.0.0.1)",
          "Gateway auth: Token (default)",
          "Tailscale exposure: Off",
          "Direct to chat channels.",
        ];
    await prompter.note(quickstartLines.join("\n"), "QuickStart");
  }

  const localPort = resolveGatewayPort(baseConfig);
  const localUrl = `ws://127.0.0.1:${localPort}`;
  const localProbe = await onboardHelpers.probeGatewayReachable({
    url: localUrl,
    token: baseConfig.gateway?.auth?.token ?? process.env.BUILDERFORCE_AGENTS_GATEWAY_TOKEN,
    password: baseConfig.gateway?.auth?.password ?? process.env.BUILDERFORCE_AGENTS_GATEWAY_PASSWORD,
  });
  const remoteUrl = baseConfig.gateway?.remote?.url?.trim() ?? "";
  const remoteProbe = remoteUrl
    ? await onboardHelpers.probeGatewayReachable({
        url: remoteUrl,
        token: baseConfig.gateway?.remote?.token,
      })
    : null;

  const mode =
    opts.mode ??
    (flow === "quickstart"
      ? "local"
      : ((await prompter.select({
          message: "What do you want to set up?",
          options: [
            {
              value: "local",
              label: "Local gateway (this machine)",
              hint: localProbe.ok
                ? `Gateway reachable (${localUrl})`
                : `No gateway detected (${localUrl})`,
            },
            {
              value: "remote",
              label: "Remote gateway (info-only)",
              hint: !remoteUrl
                ? "No remote URL configured yet"
                : remoteProbe?.ok
                  ? `Gateway reachable (${remoteUrl})`
                  : `Configured but unreachable (${remoteUrl})`,
            },
          ],
        })) as OnboardMode));

  if (mode === "remote") {
    const { promptRemoteGatewayConfig } = await import("../commands/onboard-remote.js");
    const { logConfigUpdated } = await import("../config/logging.js");
    let nextConfig = await promptRemoteGatewayConfig(baseConfig, prompter);
    nextConfig = onboardHelpers.applyWizardMetadata(nextConfig, { command: "onboard", mode });
    await writeConfigFile(nextConfig);
    logConfigUpdated(runtime);
    await prompter.outro("Remote gateway configured.");
    return;
  }

  const existingWorkspace =
    baseConfig.agents?.defaults?.workspace ?? onboardHelpers.DEFAULT_WORKSPACE;
  const workspaceInput =
    opts.workspace ??
    (flow === "quickstart" || keepExistingValues
      ? existingWorkspace
      : await prompter.text({
          message: "Workspace directory",
          initialValue: existingWorkspace,
        }));

  const workspaceDir = resolveUserPath(workspaceInput.trim() || onboardHelpers.DEFAULT_WORKSPACE);

  const { applyOnboardingLocalWorkspaceConfig } = await import("../commands/onboard-config.js");
  let nextConfig: BuilderForceAgentsConfig = applyOnboardingLocalWorkspaceConfig(baseConfig, workspaceDir);

  const { promptAuthChoiceGrouped } = await import("../commands/auth-choice-prompt.js");
  const { promptCustomApiConfig } = await import("../commands/onboard-custom.js");
  const { applyAuthChoice, resolvePreferredProviderForAuthChoice, warnIfModelConfigLooksOff } =
    await import("../commands/auth-choice.js");
  const { applyPrimaryModel, promptDefaultModel } = await import("../commands/model-picker.js");

  const shouldReuseExistingAuth = keepExistingValues && hasConfiguredModelOrAuth(nextConfig);
  if (shouldReuseExistingAuth) {
    await prompter.note("Keeping existing model/auth configuration.", "Model/auth provider");
  } else {
    const authStore = await ensureAuthProfileStore(undefined, {
      allowKeychainPrompt: false,
    });
    const authChoiceFromPrompt = opts.authChoice === undefined;
    const authChoice =
      opts.authChoice ??
      (await promptAuthChoiceGrouped({
        prompter,
        store: authStore,
        includeSkip: true,
      }));

    if (authChoice === "custom-api-key") {
      const customResult = await promptCustomApiConfig({
        prompter,
        runtime,
        config: nextConfig,
      });
      nextConfig = customResult.config;
    } else {
      const authResult = await applyAuthChoice({
        authChoice,
        config: nextConfig,
        prompter,
        runtime,
        setDefaultModel: true,
        opts: {
          tokenProvider: opts.tokenProvider,
          token: opts.authChoice === "apiKey" && opts.token ? opts.token : undefined,
        },
      });
      nextConfig = authResult.config;
    }

    if (
      authChoiceFromPrompt &&
      authChoice !== "custom-api-key" &&
      authChoice !== "local" &&
      authChoice !== "builderforcellm"
    ) {
      const modelSelection = await promptDefaultModel({
        config: nextConfig,
        prompter,
        allowKeep: true,
        ignoreAllowlist: true,
        includeVllm: true,
        preferredProvider: resolvePreferredProviderForAuthChoice(authChoice),
      });
      if (modelSelection.config) {
        nextConfig = modelSelection.config;
      }
      if (modelSelection.model) {
        nextConfig = applyPrimaryModel(nextConfig, modelSelection.model);
      }
    }

    const primaryModel =
      typeof nextConfig.agents?.defaults?.model?.primary === "string"
        ? nextConfig.agents.defaults.model.primary.trim().toLowerCase()
        : "";
    const usesBuilderForceAgentsLlm =
      primaryModel === "builderforcellm" || primaryModel.startsWith("builderforcellm/");
    if (usesBuilderForceAgentsLlm) {
      const sharedKey =
        process.env.BUILDERFORCE_API_KEY?.trim() ??
        readSharedEnvVar("BUILDERFORCE_API_KEY")?.trim();
      if (!sharedKey) {
        await prompter.note(
          [
            "BuilderForceAgentsLLM requires Builderforce registration.",
            "Complete login/registration now so /model builderforcellm/auto works immediately.",
            "You can skip this and connect later — use /setup or: builderforce init --reconnect",
          ].join("\n"),
          "BuilderForceAgentsLLM",
        );
        const { promptBuilderforceOnboarding } =
          await import("../commands/builderforce-onboarding.js");
        const defaultInstanceName = path.basename(workspaceDir) || "builderforce";
        await promptBuilderforceOnboarding({
          projectRoot: workspaceDir,
          defaultInstanceName,
          forcePrompt: true,
        });

        // If still no key after the wizard, warn but don't block — the user
        // can switch models or connect later.
        const keyAfterWizard =
          process.env.BUILDERFORCE_API_KEY?.trim() ??
          readSharedEnvVar("BUILDERFORCE_API_KEY")?.trim();
        if (!keyAfterWizard) {
          await prompter.note(
            [
              "BuilderForceAgentsLLM won't work until you connect to Builderforce.",
              "You can still use BuilderForceAgents — switch models with /model or connect later.",
            ].join("\n"),
            "Skipped",
          );
        }
      }
    }

    await warnIfModelConfigLooksOff(nextConfig, prompter);
  }

  // ── Optional local brain (amygdala + hippocampus ONNX preprocessors) ────
  // Show when not skipping providers and: we're updating/resetting config, or we're keeping but don't already have local brain.
  const alreadyHasLocalBrain =
    nextConfig.models?.providers?.["builderforcellm-local"]?.api === "transformers";
  const showLocalBrainPrompt =
    !opts.skipProviders && (configHandlingAction !== "keep" || !alreadyHasLocalBrain);
  if (showLocalBrainPrompt) {
    const localBrainChoice = await prompter.select({
      message: "Enable local brain (amygdala + hippocampus)?",
      options: [
        {
          value: "smart",
          label: "Enable dual local brain",
          hint: "Downloads amygdala (SmolLM2) + hippocampus (Qwen3-0.6B). ~3.5 GB disk.",
        },
        {
          value: "skip",
          label: "Skip — use my cortex (configured LLM) only",
          hint: "No extra download. Uses whatever model you configured above.",
        },
      ],
      initialValue: "skip",
    });
    if (localBrainChoice === "smart") {
      nextConfig = { ...nextConfig, localBrain: { enabled: true } };
      const { downloadAndWireLocalBrain } =
        await import("../commands/auth-choice.apply.transformers.js");
      const result = await downloadAndWireLocalBrain({
        config: nextConfig,
        prompter,
      });
      nextConfig = { ...result.config };
    } else {
      nextConfig = { ...nextConfig, localBrain: { enabled: false } };
    }
  }

  let settings: GatewayWizardSettings;
  if (keepExistingValues && quickstartGateway.hasExisting) {
    settings = {
      port: quickstartGateway.port,
      bind: quickstartGateway.bind,
      customBindHost:
        quickstartGateway.bind === "custom" ? quickstartGateway.customBindHost : undefined,
      authMode: quickstartGateway.authMode,
      gatewayToken: quickstartGateway.authMode === "token" ? quickstartGateway.token : undefined,
      tailscaleMode: quickstartGateway.tailscaleMode,
      tailscaleResetOnExit: quickstartGateway.tailscaleResetOnExit,
    };
    await prompter.note("Keeping existing gateway settings.", "Gateway");
  } else {
    const { configureGatewayForOnboarding } = await import("./onboarding.gateway-config.js");
    const gateway = await configureGatewayForOnboarding({
      flow,
      baseConfig,
      nextConfig,
      localPort,
      quickstartGateway,
      prompter,
      runtime,
    });
    nextConfig = gateway.nextConfig;
    settings = gateway.settings;
  }

  const skipChannelsForKeep = keepExistingValues && hasConfiguredChannels(nextConfig);
  if (opts.skipChannels ?? opts.skipProviders ?? skipChannelsForKeep) {
    await prompter.note("Skipping channel setup.", "Channels");
  } else {
    const { listChannelPlugins } = await import("../channels/plugins/index.js");
    const { setupChannels } = await import("../commands/onboard-channels.js");
    const quickstartAllowFromChannels =
      flow === "quickstart"
        ? listChannelPlugins()
            .filter((plugin) => plugin.meta.quickstartAllowFrom)
            .map((plugin) => plugin.id)
        : [];
    nextConfig = await setupChannels(nextConfig, runtime, prompter, {
      allowSignalInstall: true,
      forceAllowFromChannels: quickstartAllowFromChannels,
      skipDmPolicyPrompt: flow === "quickstart",
      skipConfirm: flow === "quickstart",
      quickstartDefaults: flow === "quickstart",
    });
  }

  await writeConfigFile(nextConfig);
  const { logConfigUpdated } = await import("../config/logging.js");
  logConfigUpdated(runtime);
  await onboardHelpers.ensureWorkspaceAndSessions(workspaceDir, runtime, {
    skipBootstrap: Boolean(nextConfig.agents?.defaults?.skipBootstrap),
  });

  // Ensure .builderforce/ project directory exists in the workspace
  const { isBuilderForceAgentsProject, initializeBuilderForceAgentsProject } =
    await import("../builderforce/project-context.js");
  if (!(await isBuilderForceAgentsProject(workspaceDir))) {
    await initializeBuilderForceAgentsProject(workspaceDir);
    runtime.log("Initialised .builderforce/ project directory");
  }

  if (opts.skipSkills) {
    await prompter.note("Skipping skills setup.", "Skills");
  } else {
    const { setupSkills } = await import("../commands/onboard-skills.js");
    nextConfig = await setupSkills(nextConfig, workspaceDir, runtime, prompter);
  }

  // Setup hooks (session memory on /new)
  const { setupInternalHooks } = await import("../commands/onboard-hooks.js");
  nextConfig = await setupInternalHooks(nextConfig, runtime, prompter);

  nextConfig = onboardHelpers.applyWizardMetadata(nextConfig, { command: "onboard", mode });
  await writeConfigFile(nextConfig);

  const { finalizeOnboardingWizard } = await import("./onboarding.finalize.js");
  const { launchedTui } = await finalizeOnboardingWizard({
    flow,
    opts,
    baseConfig,
    nextConfig,
    workspaceDir,
    settings,
    prompter,
    runtime,
  });
  if (launchedTui) {
    return;
  }
}
