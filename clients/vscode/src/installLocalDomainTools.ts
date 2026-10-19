/**
 * Install the local domain tools already on origin/main
 * (`localDomainTools.ts`, 8a59bb818).
 *
 * This is not a second writer. `createLocalDomainToolsWithRepository` builds the
 * G05 repository and the G06 tool set. A denial writes that repository and
 * queues the journal event the transaction appended. It does not call the
 * platform client.
 *
 * The run host (the file named in prose only, never imported) installs this on its
 * tool-dispatch path and routes a denied domain tool through it — see
 * `HOST_DOMAIN_TOOL_LINE`. The library is idempotent per host context and reuses
 * the device id the host already holds. This module stays free of `vscode` and of
 * any host import, so the host file is the only place that binds the two.
 */
import type { LocalFirstStore } from "@builderforce/local-first";
import {
  createInMemoryLocalSyncQueue,
  createLocalDomainToolsWithRepository,
  type LocalDomainPlatformCaller,
  type LocalDomainPlatformPolicy,
  type LocalDomainSyncQueue,
  type LocalDomainTools,
  type LocalWorkRepositoryPort,
} from "./localDomainTools";

export interface DomainToolRequest {
  tool: string;
  args?: Readonly<Record<string, unknown>>;
}

export interface LocalDomainToolPorts {
  getConfig?(key: string): unknown;
  localDeviceId?: string;
  localFirstStore?: LocalFirstStore;
  repository?: LocalWorkRepositoryPort;
  syncQueue?: LocalDomainSyncQueue;
  platformPolicy?: LocalDomainPlatformPolicy;
  /** Explicit grant for every landed domain tool. Omitted means denied. */
  policyAllows?: boolean;
  platformTool?: LocalDomainPlatformCaller;
}

export interface InstalledLocalDomainTools {
  readonly tools: LocalDomainTools;
  readonly syncQueue: LocalDomainSyncQueue;
  execute(
    toolOrRequest: string | DomainToolRequest,
    args?: Readonly<Record<string, unknown>>,
  ): ReturnType<LocalDomainTools["execute"]>;
}

/**
 * The dispatch line the host uses after install — the host's executor returns
 * exactly this. Pinned by the host-wiring cases in the suite.
 */
export const HOST_DOMAIN_TOOL_LINE = "return installLocalDomainTools(ctx).execute(request);";

const INSTALLED = new WeakMap<object, InstalledLocalDomainTools>();

function deviceIdOf(ports: LocalDomainToolPorts): string {
  const fromConfig = ports.getConfig?.("builderforce.localDeviceId");
  const configured = typeof fromConfig === "string" ? fromConfig.trim() : "";
  if (configured) return configured;
  const held = ports.localDeviceId?.trim();
  if (held) return held;
  throw new Error("local_device_id_required");
}

function storeOf(ports: LocalDomainToolPorts): LocalFirstStore {
  if (!ports.localFirstStore) throw new Error("local_first_store_required");
  return ports.localFirstStore;
}

function policyOf(ports: LocalDomainToolPorts): LocalDomainPlatformPolicy | undefined {
  if (ports.platformPolicy) return ports.platformPolicy;
  if (ports.policyAllows === undefined) return undefined;
  return { allows: () => ports.policyAllows === true };
}

export function installLocalDomainTools(
  ctx: object,
  ports: LocalDomainToolPorts = {},
): InstalledLocalDomainTools {
  const existing = INSTALLED.get(ctx);
  if (existing) return existing;
  const store = storeOf(ports);
  const deviceId = deviceIdOf(ports);
  const syncQueue = ports.syncQueue ?? createInMemoryLocalSyncQueue();
  const platformPolicy = policyOf(ports);
  const tools = createLocalDomainToolsWithRepository({
    store,
    deviceId,
    syncQueue,
    ...(ports.repository ? { repository: ports.repository } : {}),
    ...(platformPolicy ? { platformPolicy } : {}),
    ...(ports.platformTool ? { platformTool: ports.platformTool } : {}),
  });
  const installed: InstalledLocalDomainTools = {
    tools,
    syncQueue,
    execute(toolOrRequest, args) {
      if (typeof toolOrRequest === "string") return tools.execute(toolOrRequest, args ?? {});
      return tools.execute(toolOrRequest.tool, toolOrRequest.args ?? args ?? {});
    },
  };
  INSTALLED.set(ctx, installed);
  return installed;
}
