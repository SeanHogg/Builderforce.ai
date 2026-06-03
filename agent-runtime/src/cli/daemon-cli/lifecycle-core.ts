import { loadConfig } from "../../config/config.js";
import { resolveIsNixMode } from "../../config/paths.js";
import { readRecentGatewayLogErrors } from "../../daemon/diagnostics.js";
import { checkTokenDrift } from "../../daemon/service-audit.js";
import type { GatewayService } from "../../daemon/service.js";
import { renderSystemdUnavailableHints } from "../../daemon/systemd-hints.js";
import { isSystemdUserServiceAvailable } from "../../daemon/systemd.js";
import { isWSL } from "../../infra/wsl.js";
import { appendGatewayLifecycleAudit } from "../../logging.js";
import { defaultRuntime } from "../../runtime.js";
import {
  buildDaemonServiceSnapshot,
  createNullWriter,
  type DaemonAction,
  emitDaemonActionJson,
} from "./response.js";

type DaemonLifecycleOptions = {
  json?: boolean;
};

const POST_START_SETTLE_MS = 2000;
const POST_START_HEALTH_POLL_MS = 1000;
const POST_START_HEALTH_TIMEOUT_MS = 120_000;

type ServiceHealthProbe = () => Promise<boolean>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait briefly after a service start/restart, then check if the process is
 * still running.  Background services (especially on Windows with hidden
 * windows) swallow stderr, so a quick crash is invisible to the caller.
 *
 * Returns `null` when the service appears healthy, or an object with recent
 * ERROR log lines when it looks like the process exited.
 */
async function detectServiceCrash(
  service: GatewayService,
  since: Date,
  waitUntilHealthy?: ServiceHealthProbe,
): Promise<{ errors: string[] } | null> {
  await sleep(POST_START_SETTLE_MS);
  try {
    const runtime = await service.readRuntime(process.env as Record<string, string | undefined>);
    if (runtime.status === "running") {
      return null;
    }
    if (waitUntilHealthy) {
      const deadline = Date.now() + POST_START_HEALTH_TIMEOUT_MS;
      while (Date.now() < deadline) {
        if (await waitUntilHealthy().catch(() => false)) {
          return null;
        }
        const errors = await readRecentGatewayLogErrors(since, { maxEntries: 5 });
        if (errors.length > 0) {
          return { errors };
        }
        await sleep(POST_START_HEALTH_POLL_MS);
      }
    }
    const errors = await readRecentGatewayLogErrors(since);
    return { errors };
  } catch {
    return null;
  }
}

async function maybeAugmentSystemdHints(hints: string[]): Promise<string[]> {
  if (process.platform !== "linux") {
    return hints;
  }
  const systemdAvailable = await isSystemdUserServiceAvailable().catch(() => false);
  if (systemdAvailable) {
    return hints;
  }
  return [...hints, ...renderSystemdUnavailableHints({ wsl: await isWSL() })];
}

function createActionIO(params: { action: DaemonAction; json: boolean }) {
  const stdout = params.json ? createNullWriter() : process.stdout;
  const emit = (payload: {
    ok: boolean;
    result?: string;
    message?: string;
    error?: string;
    hints?: string[];
    warnings?: string[];
    service?: {
      label: string;
      loaded: boolean;
      loadedText: string;
      notLoadedText: string;
    };
  }) => {
    if (!params.json) {
      return;
    }
    emitDaemonActionJson({ action: params.action, ...payload });
  };
  const fail = (message: string, hints?: string[]) => {
    if (params.json) {
      emit({ ok: false, error: message, hints });
    } else {
      defaultRuntime.error(message);
    }
    defaultRuntime.exit(1);
  };
  return { stdout, emit, fail };
}

async function handleServiceNotLoaded(params: {
  serviceNoun: string;
  service: GatewayService;
  loaded: boolean;
  renderStartHints: () => string[];
  json: boolean;
  emit: ReturnType<typeof createActionIO>["emit"];
}) {
  const hints = await maybeAugmentSystemdHints(params.renderStartHints());
  params.emit({
    ok: true,
    result: "not-loaded",
    message: `${params.serviceNoun} service ${params.service.notLoadedText}.`,
    hints,
    service: buildDaemonServiceSnapshot(params.service, params.loaded),
  });
  if (!params.json) {
    defaultRuntime.log(`${params.serviceNoun} service ${params.service.notLoadedText}.`);
    for (const hint of hints) {
      defaultRuntime.log(`Start with: ${hint}`);
    }
  }
}

async function resolveServiceLoadedOrFail(params: {
  serviceNoun: string;
  service: GatewayService;
  fail: ReturnType<typeof createActionIO>["fail"];
}): Promise<boolean | null> {
  try {
    return await params.service.isLoaded({ env: process.env });
  } catch (err) {
    params.fail(`${params.serviceNoun} service check failed: ${String(err)}`);
    return null;
  }
}

export async function runServiceUninstall(params: {
  serviceNoun: string;
  service: GatewayService;
  opts?: DaemonLifecycleOptions;
  stopBeforeUninstall: boolean;
  assertNotLoadedAfterUninstall: boolean;
}) {
  const json = Boolean(params.opts?.json);
  const { stdout, emit, fail } = createActionIO({ action: "uninstall", json });

  if (resolveIsNixMode(process.env)) {
    fail("Nix mode detected; service uninstall is disabled.");
    return;
  }

  let loaded = false;
  try {
    loaded = await params.service.isLoaded({ env: process.env });
  } catch {
    loaded = false;
  }
  if (loaded && params.stopBeforeUninstall) {
    try {
      await params.service.stop({ env: process.env, stdout });
    } catch {
      // Best-effort stop; final loaded check gates success when enabled.
    }
  }
  try {
    await params.service.uninstall({ env: process.env, stdout });
  } catch (err) {
    fail(`${params.serviceNoun} uninstall failed: ${String(err)}`);
    return;
  }

  loaded = false;
  try {
    loaded = await params.service.isLoaded({ env: process.env });
  } catch {
    loaded = false;
  }
  if (loaded && params.assertNotLoadedAfterUninstall) {
    fail(`${params.serviceNoun} service still loaded after uninstall.`);
    return;
  }
  emit({
    ok: true,
    result: "uninstalled",
    service: buildDaemonServiceSnapshot(params.service, loaded),
  });
}

export async function runServiceStart(params: {
  serviceNoun: string;
  service: GatewayService;
  renderStartHints: () => string[];
  opts?: DaemonLifecycleOptions;
  waitUntilHealthy?: ServiceHealthProbe;
}) {
  const json = Boolean(params.opts?.json);
  const { stdout, emit, fail } = createActionIO({ action: "start", json });

  const loaded = await resolveServiceLoadedOrFail({
    serviceNoun: params.serviceNoun,
    service: params.service,
    fail,
  });
  if (loaded === null) {
    return;
  }
  if (!loaded) {
    await handleServiceNotLoaded({
      serviceNoun: params.serviceNoun,
      service: params.service,
      loaded,
      renderStartHints: params.renderStartHints,
      json,
      emit,
    });
    return;
  }
  const restartTime = new Date();
  appendGatewayLifecycleAudit({ action: "start", source: "builderforce gateway start" });
  try {
    await params.service.restart({ env: process.env, stdout });
  } catch (err) {
    const hints = params.renderStartHints();
    fail(`${params.serviceNoun} start failed: ${String(err)}`, hints);
    return;
  }

  const crashed = await detectServiceCrash(params.service, restartTime, params.waitUntilHealthy);
  if (crashed) {
    if (json) {
      emit({
        ok: false,
        error: `${params.serviceNoun} started but exited immediately`,
        hints: crashed.errors.length > 0 ? crashed.errors : undefined,
        service: buildDaemonServiceSnapshot(params.service, false),
      });
    } else {
      defaultRuntime.error(`${params.serviceNoun} started but exited immediately.`);
      for (const line of crashed.errors) {
        defaultRuntime.error(`  ${line}`);
      }
      if (crashed.errors.length === 0) {
        defaultRuntime.error("  Check gateway logs for details.");
      }
    }
    defaultRuntime.exit(1);
    return;
  }

  let started = true;
  try {
    started = await params.service.isLoaded({ env: process.env });
  } catch {
    started = true;
  }
  emit({
    ok: true,
    result: "started",
    service: buildDaemonServiceSnapshot(params.service, started),
  });
}

export async function runServiceStop(params: {
  serviceNoun: string;
  service: GatewayService;
  opts?: DaemonLifecycleOptions;
}) {
  const json = Boolean(params.opts?.json);
  const { stdout, emit, fail } = createActionIO({ action: "stop", json });

  const loaded = await resolveServiceLoadedOrFail({
    serviceNoun: params.serviceNoun,
    service: params.service,
    fail,
  });
  if (loaded === null) {
    return;
  }
  if (!loaded) {
    emit({
      ok: true,
      result: "not-loaded",
      message: `${params.serviceNoun} service ${params.service.notLoadedText}.`,
      service: buildDaemonServiceSnapshot(params.service, loaded),
    });
    if (!json) {
      defaultRuntime.log(`${params.serviceNoun} service ${params.service.notLoadedText}.`);
    }
    return;
  }
  appendGatewayLifecycleAudit({ action: "stop", source: "builderforce gateway stop" });
  try {
    await params.service.stop({ env: process.env, stdout });
  } catch (err) {
    fail(`${params.serviceNoun} stop failed: ${String(err)}`);
    return;
  }

  let stopped = false;
  try {
    stopped = await params.service.isLoaded({ env: process.env });
  } catch {
    stopped = false;
  }
  emit({
    ok: true,
    result: "stopped",
    service: buildDaemonServiceSnapshot(params.service, stopped),
  });
}

export async function runServiceRestart(params: {
  serviceNoun: string;
  service: GatewayService;
  renderStartHints: () => string[];
  opts?: DaemonLifecycleOptions;
  checkTokenDrift?: boolean;
  waitUntilHealthy?: ServiceHealthProbe;
}): Promise<boolean> {
  const json = Boolean(params.opts?.json);
  const { stdout, emit, fail } = createActionIO({ action: "restart", json });

  const loaded = await resolveServiceLoadedOrFail({
    serviceNoun: params.serviceNoun,
    service: params.service,
    fail,
  });
  if (loaded === null) {
    return false;
  }
  if (!loaded) {
    await handleServiceNotLoaded({
      serviceNoun: params.serviceNoun,
      service: params.service,
      loaded,
      renderStartHints: params.renderStartHints,
      json,
      emit,
    });
    return false;
  }

  const warnings: string[] = [];
  if (params.checkTokenDrift) {
    // Check for token drift before restart (service token vs config token)
    try {
      const command = await params.service.readCommand(process.env);
      const serviceToken = command?.environment?.BUILDERFORCE_AGENTS_GATEWAY_TOKEN;
      const cfg = loadConfig();
      const configToken =
        cfg.gateway?.auth?.token ||
        process.env.BUILDERFORCE_AGENTS_GATEWAY_TOKEN ||
        process.env.BUILDERFORCE_AGENTS_GATEWAY_TOKEN;
      const driftIssue = checkTokenDrift({ serviceToken, configToken });
      if (driftIssue) {
        const warning = driftIssue.detail
          ? `${driftIssue.message} ${driftIssue.detail}`
          : driftIssue.message;
        warnings.push(warning);
        if (!json) {
          defaultRuntime.log(`\n⚠️  ${driftIssue.message}`);
          if (driftIssue.detail) {
            defaultRuntime.log(`   ${driftIssue.detail}\n`);
          }
        }
      }
    } catch {
      // Non-fatal: token drift check is best-effort
    }
  }

  const restartTime = new Date();
  appendGatewayLifecycleAudit({ action: "restart", source: "builderforce gateway restart" });
  try {
    await params.service.restart({ env: process.env, stdout });
  } catch (err) {
    const hints = params.renderStartHints();
    fail(`${params.serviceNoun} restart failed: ${String(err)}`, hints);
    return false;
  }

  const crashed = await detectServiceCrash(params.service, restartTime, params.waitUntilHealthy);
  if (crashed) {
    if (json) {
      emit({
        ok: false,
        error: `${params.serviceNoun} restarted but exited immediately`,
        hints: crashed.errors.length > 0 ? crashed.errors : undefined,
        service: buildDaemonServiceSnapshot(params.service, false),
        warnings: warnings.length ? warnings : undefined,
      });
    } else {
      defaultRuntime.error(`${params.serviceNoun} restarted but exited immediately.`);
      for (const line of crashed.errors) {
        defaultRuntime.error(`  ${line}`);
      }
      if (crashed.errors.length === 0) {
        defaultRuntime.error("  Check gateway logs for details.");
      }
    }
    defaultRuntime.exit(1);
    return false;
  }

  let restarted = true;
  try {
    restarted = await params.service.isLoaded({ env: process.env });
  } catch {
    restarted = true;
  }
  emit({
    ok: true,
    result: "restarted",
    service: buildDaemonServiceSnapshot(params.service, restarted),
    warnings: warnings.length ? warnings : undefined,
  });
  return true;
}
