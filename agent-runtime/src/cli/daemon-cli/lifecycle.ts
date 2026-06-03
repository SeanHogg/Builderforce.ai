import { loadConfig, resolveGatewayPort } from "../../config/config.js";
import { resolveGatewayService } from "../../daemon/service.js";
import { resolveGatewayBindHost } from "../../gateway/net.js";
import { classifyPortListener, inspectPortUsage } from "../../infra/ports.js";
import { pickPrimaryTailnetIPv4 } from "../../infra/tailnet.js";
import {
  runServiceRestart,
  runServiceStart,
  runServiceStop,
  runServiceUninstall,
} from "./lifecycle-core.js";
import { probeGatewayStatus } from "./probe.js";
import { pickProbeHostForBind, renderGatewayServiceStartHints } from "./shared.js";
import type { DaemonLifecycleOptions } from "./types.js";

const STALE_GATEWAY_RELEASE_TIMEOUT_MS = 5_000;
const STALE_GATEWAY_RELEASE_POLL_MS = 100;

async function probeGatewayHealth(): Promise<boolean> {
  try {
    const cfg = loadConfig();
    const bindMode = cfg.gateway?.bind ?? "loopback";
    const customBindHost =
      typeof cfg.gateway?.customBindHost === "string" ? cfg.gateway.customBindHost : undefined;
    const probeHost = pickProbeHostForBind(bindMode, pickPrimaryTailnetIPv4(), customBindHost);
    const port = resolveGatewayPort(cfg, process.env);
    const resolvedBindHost = await resolveGatewayBindHost(bindMode, customBindHost);
    const url = `ws://${probeHost || resolvedBindHost}:${port}`;
    const result = await probeGatewayStatus({
      url,
      token: cfg.gateway?.auth?.token || process.env.BUILDERFORCE_AGENTS_GATEWAY_TOKEN,
      password: cfg.gateway?.auth?.password || process.env.BUILDERFORCE_AGENTS_GATEWAY_PASSWORD,
      timeoutMs: 2000,
      json: true,
      configPath: process.env.BUILDERFORCE_AGENTS_CONFIG_PATH,
    });
    return result.ok;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function clearStaleGatewayProcessIfNeeded(): Promise<void> {
  const service = resolveGatewayService();
  const runtime = await service
    .readRuntime(process.env as Record<string, string | undefined>)
    .catch(() => null);
  if (runtime?.status === "running") {
    return;
  }

  const cfg = loadConfig();
  const port = resolveGatewayPort(cfg, process.env);
  const diagnostics = await inspectPortUsage(port).catch(() => null);
  if (!diagnostics || diagnostics.status !== "busy") {
    return;
  }

  const staleListeners = diagnostics.listeners.filter(
    (listener) =>
      typeof listener.pid === "number" && classifyPortListener(listener, port) === "gateway",
  );
  if (staleListeners.length === 0) {
    return;
  }

  for (const listener of staleListeners) {
    process.kill(listener.pid!);
  }

  const deadline = Date.now() + STALE_GATEWAY_RELEASE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const next = await inspectPortUsage(port).catch(() => null);
    const staleStillPresent =
      next?.status === "busy" &&
      next.listeners.some(
        (listener) =>
          typeof listener.pid === "number" &&
          staleListeners.some((stale) => stale.pid === listener.pid) &&
          classifyPortListener(listener, port) === "gateway",
      );
    if (!staleStillPresent) {
      return;
    }
    await sleep(STALE_GATEWAY_RELEASE_POLL_MS);
  }

  throw new Error(
    `Gateway restart cleanup failed: stale listener(s) on port ${port} did not exit: ${staleListeners
      .map((listener) => listener.pid)
      .join(", ")}`,
  );
}

export async function runDaemonUninstall(opts: DaemonLifecycleOptions = {}) {
  return await runServiceUninstall({
    serviceNoun: "Gateway",
    service: resolveGatewayService(),
    opts,
    stopBeforeUninstall: true,
    assertNotLoadedAfterUninstall: true,
  });
}

export async function runDaemonStart(opts: DaemonLifecycleOptions = {}) {
  await clearStaleGatewayProcessIfNeeded();
  return await runServiceStart({
    serviceNoun: "Gateway",
    service: resolveGatewayService(),
    renderStartHints: renderGatewayServiceStartHints,
    opts,
    waitUntilHealthy: probeGatewayHealth,
  });
}

export async function runDaemonStop(opts: DaemonLifecycleOptions = {}) {
  return await runServiceStop({
    serviceNoun: "Gateway",
    service: resolveGatewayService(),
    opts,
  });
}

/**
 * Restart the gateway service service.
 * @returns `true` if restart succeeded, `false` if the service was not loaded.
 * Throws/exits on check or restart failures.
 */
export async function runDaemonRestart(opts: DaemonLifecycleOptions = {}): Promise<boolean> {
  await clearStaleGatewayProcessIfNeeded();
  return await runServiceRestart({
    serviceNoun: "Gateway",
    service: resolveGatewayService(),
    renderStartHints: renderGatewayServiceStartHints,
    opts,
    checkTokenDrift: true,
    waitUntilHealthy: probeGatewayHealth,
  });
}
