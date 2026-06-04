import chalk from "chalk";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "../agents/defaults.js";
import { resolveConfiguredModelRef } from "../agents/model-selection.js";
import type { loadConfig } from "../config/config.js";
import { getResolvedLoggerSettings } from "../logging.js";

/**
 * When the local brain is the primary model, resolve the actual LLM the user
 * selected (stored as the first fallback) so the startup log shows the model
 * users interact with rather than the internal local-brain model id.
 */
function resolveDisplayModelRef(cfg: ReturnType<typeof loadConfig>): {
  provider: string;
  model: string;
  localBrain: boolean;
} {
  const resolved = resolveConfiguredModelRef({
    cfg,
    defaultProvider: DEFAULT_PROVIDER,
    defaultModel: DEFAULT_MODEL,
  });

  const localBrainEnabled = Boolean(cfg.localBrain?.enabled);
  const isLocalBrainPrimary = resolved.provider === "builderforcellm-local";

  if (localBrainEnabled && isLocalBrainPrimary) {
    // The actual LLM lives in the fallbacks list.
    const modelCfg = cfg.agents?.defaults?.model;
    const fallbacks =
      typeof modelCfg === "object" && modelCfg
        ? (modelCfg as { fallbacks?: string[] }).fallbacks
        : undefined;
    const firstFallback = fallbacks?.[0]?.trim();
    if (firstFallback) {
      const slashIdx = firstFallback.indexOf("/");
      if (slashIdx > 0) {
        return {
          provider: firstFallback.slice(0, slashIdx),
          model: firstFallback.slice(slashIdx + 1),
          localBrain: true,
        };
      }
      return { provider: firstFallback, model: "auto", localBrain: true };
    }
    // No fallback configured — show the primary but still flag local brain.
    return { ...resolved, localBrain: true };
  }

  return { ...resolved, localBrain: localBrainEnabled };
}

export function logGatewayStartup(params: {
  cfg: ReturnType<typeof loadConfig>;
  bindHost: string;
  bindHosts?: string[];
  port: number;
  tlsEnabled?: boolean;
  log: { info: (msg: string, meta?: Record<string, unknown>) => void };
  isNixMode: boolean;
}) {
  const {
    provider: agentProvider,
    model: agentModel,
    localBrain,
  } = resolveDisplayModelRef(params.cfg);
  const modelRef = `${agentProvider}/${agentModel}`;
  params.log.info(`cortex: ${modelRef}`, {
    consoleMessage: `cortex: ${chalk.whiteBright(modelRef)}`,
  });
  if (localBrain) {
    const amygdala = params.cfg.localBrain?.models?.amygdala?.modelId ?? "SmolLM2-1.7B";
    const hippocampus = params.cfg.localBrain?.models?.hippocampus?.modelId ?? "Qwen3-0.6B-ONNX";
    params.log.info(`amygdala: ${amygdala} (fast router)`, {
      consoleMessage: `amygdala: ${chalk.greenBright(amygdala)} (fast router)`,
    });
    params.log.info(`hippocampus: ${hippocampus} (memory)`, {
      consoleMessage: `hippocampus: ${chalk.greenBright(hippocampus)} (memory)`,
    });
  }
  const scheme = params.tlsEnabled ? "wss" : "ws";
  const formatHost = (host: string) => (host.includes(":") ? `[${host}]` : host);
  const hosts =
    params.bindHosts && params.bindHosts.length > 0 ? params.bindHosts : [params.bindHost];
  const primaryHost = hosts[0] ?? params.bindHost;
  params.log.info(
    `listening on ${scheme}://${formatHost(primaryHost)}:${params.port} (PID ${process.pid})`,
  );
  for (const host of hosts.slice(1)) {
    params.log.info(`listening on ${scheme}://${formatHost(host)}:${params.port}`);
  }
  params.log.info(`log file: ${getResolvedLoggerSettings().file}`);
  if (params.isNixMode) {
    params.log.info("gateway: running in Nix mode (config managed externally)");
  }
}
