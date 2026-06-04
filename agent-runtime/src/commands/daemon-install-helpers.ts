import os from "node:os";
import { formatCliCommand } from "../cli/command-format.js";
import { collectConfigEnvVars } from "../config/env-vars.js";
import type { BuilderForceAgentsConfig } from "../config/types.js";
import { resolveGatewayLaunchAgentLabel } from "../daemon/constants.js";
import { resolveGatewayProgramArguments } from "../daemon/program-args.js";
import { resolvePreferredNodePath } from "../daemon/runtime-paths.js";
import { buildServiceEnvironment } from "../daemon/service-env.js";
import { resolveRequiredHomeDir } from "../infra/home-dir.js";
import {
  emitNodeRuntimeWarning,
  type DaemonInstallWarnFn,
} from "./daemon-install-runtime-warning.js";
import type { GatewayDaemonRuntime } from "./daemon-runtime.js";

export type GatewayInstallPlan = {
  programArguments: string[];
  workingDirectory?: string;
  environment: Record<string, string | undefined>;
};

export function resolveGatewayDevMode(argv: string[] = process.argv): boolean {
  const entry = argv[1];
  const normalizedEntry = entry?.replaceAll("\\", "/");
  return Boolean(normalizedEntry?.includes("/src/") && normalizedEntry.endsWith(".ts"));
}

export async function buildGatewayInstallPlan(params: {
  env: Record<string, string | undefined>;
  port: number;
  runtime: GatewayDaemonRuntime;
  token?: string;
  devMode?: boolean;
  nodePath?: string;
  warn?: DaemonInstallWarnFn;
  /** Full config to extract env vars from (env vars + inline env keys). */
  config?: BuilderForceAgentsConfig;
}): Promise<GatewayInstallPlan> {
  const devMode = params.devMode ?? resolveGatewayDevMode();
  const nodePath =
    params.nodePath ??
    (await resolvePreferredNodePath({
      env: params.env,
      runtime: params.runtime,
    }));
  let { programArguments, workingDirectory } = await resolveGatewayProgramArguments({
    port: params.port,
    dev: devMode,
    runtime: params.runtime,
    nodePath,
  });
  // On Windows, when the task has no working directory, schtasks defaults to System32.
  // The gateway uses process.cwd() for the project root and fails to create .builderforce there.
  // Use the user's home as a safe default so the gateway can start.
  if (!workingDirectory && process.platform === "win32") {
    workingDirectory = resolveRequiredHomeDir(params.env, os.homedir);
  }
  await emitNodeRuntimeWarning({
    env: params.env,
    runtime: params.runtime,
    nodeProgram: programArguments[0],
    warn: params.warn,
    title: "Gateway runtime",
  });
  const serviceEnvironment = buildServiceEnvironment({
    env: params.env,
    port: params.port,
    token: params.token,
    launchdLabel:
      process.platform === "darwin"
        ? resolveGatewayLaunchAgentLabel(params.env.BUILDERFORCE_AGENTS_PROFILE)
        : undefined,
  });

  // Merge config env vars into the service environment (vars + inline env keys).
  // Config env vars are added first so service-specific vars take precedence.
  const environment: Record<string, string | undefined> = {
    ...collectConfigEnvVars(params.config),
  };
  Object.assign(environment, serviceEnvironment);

  return { programArguments, workingDirectory, environment };
}

export function gatewayInstallErrorHint(platform = process.platform): string {
  return platform === "win32"
    ? "Tip: rerun from an elevated PowerShell (Start → type PowerShell → right-click → Run as administrator) or skip service install."
    : `Tip: rerun \`${formatCliCommand("builderforce gateway install")}\` after fixing the error.`;
}
