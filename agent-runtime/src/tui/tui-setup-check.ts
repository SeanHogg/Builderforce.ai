import { loadConfig, readConfigFileSnapshot } from "../config/io.js";
import type { BuilderForceAgentsConfig } from "../config/types.js";

export type SetupCheckResult = { needed: false } | { needed: true; hint: string };

// Local copy of the same logic in src/wizard/onboarding.ts:69 — kept here to
// avoid pulling the entire wizard layer into the TUI startup path.
function hasConfiguredModelOrAuth(config: BuilderForceAgentsConfig): boolean {
  const defaultsModel = config.agents?.defaults?.model;
  const hasDefaultModel =
    typeof defaultsModel?.primary === "string" && defaultsModel.primary.trim().length > 0;
  const hasModelCatalog =
    Boolean(config.models) && Object.keys(config.models as Record<string, unknown>).length > 0;
  return hasDefaultModel || hasModelCatalog;
}

/**
 * Checks whether first-time setup is needed before the TUI can be useful.
 * Returns { needed: true } when no config exists or no model/auth is configured.
 * On any unexpected error, returns { needed: false } so the TUI still launches.
 */
export async function checkIfSetupNeeded(): Promise<SetupCheckResult> {
  try {
    const snapshot = await readConfigFileSnapshot();
    if (!snapshot.exists) {
      return { needed: true, hint: "No config found — running first-time setup." };
    }
    if (!hasConfiguredModelOrAuth(snapshot.config)) {
      return { needed: true, hint: "Config exists but no model is configured — running setup." };
    }
    return { needed: false };
  } catch {
    // If config can't be read, let the TUI launch and surface its own errors.
    return { needed: false };
  }
}

/**
 * Spawns the gateway as a detached background process using the same Node
 * executable and CLI entry point as the current process, then waits up to
 * 5 seconds for it to become reachable.
 *
 * This is the fallback when daemon installation fails (e.g. no admin rights
 * on Windows) — it starts the gateway for the current session without
 * requiring a system service.
 *
 * Returns true if the gateway is reachable after spawning, false otherwise.
 */
export async function startGatewayBackground(): Promise<boolean> {
  try {
    const config = loadConfig();
    const port = config.gateway?.port ?? 18789;
    const bind = (config.gateway?.bind as string | undefined) ?? "loopback";
    const token = config.gateway?.auth?.token;

    // Spawn gateway run using the same executable + entry point as the current
    // process so it picks up the same installation (dev build or global install).
    const args = [process.argv[1], "gateway", "run", "--port", String(port), "--bind", bind];
    if (token) {
      args.push("--token", token);
    }

    const { buildGatewayConnectionDetails } = await import("../gateway/call.js");
    const { waitForGatewayReachable } = await import("../commands/onboard-helpers.js");
    const { url } = buildGatewayConnectionDetails({ config });

    // Don't spawn another gateway if one is already reachable.
    const already = await waitForGatewayReachable({ url, token, deadlineMs: 500 });
    if (already.ok) {
      return true;
    }

    const { spawn } = await import("node:child_process");
    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true, // prevent stray console windows on Windows
      cwd: process.cwd(),
      // Skip channel init for faster startup; gateway still serves the TUI.
      env: { ...process.env, BUILDERFORCE_AGENTS_SKIP_CHANNELS: "1" },
    });
    child.unref();

    // Poll until the gateway responds or the deadline passes.
    const result = await waitForGatewayReachable({ url, token, deadlineMs: 5000 });
    return result.ok;
  } catch {
    return false;
  }
}
