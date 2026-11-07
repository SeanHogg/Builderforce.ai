/**
 * Install the local domain tools already on origin/main
 * (`localDomainTools.ts`, 8a59bb818).
 *
 * This is not a second writer. `createLocalDomainToolsWithRepository` builds the
 * G05 repository and the G06 tool set. A write goes to that repository and
 * queues the journal event the transaction appended. It does not call the
 * platform client.
 *
 * The run host (the file named in prose only, never imported) installs this on its
 * tool-dispatch path and routes every project/ticket tool through it, whatever the
 * sync policy (`localDomainToolRouting.ts`) — see
 * `HOST_DOMAIN_TOOL_LINE`. The library is idempotent per host context and reuses
 * the device id the host already holds. This module stays free of `vscode` and of
 * any host import, so the host file is the only place that binds the two.
 */
import type { LocalFirstStore } from "@builderforce/local-first";
import {
  createInMemoryLocalSyncQueue,
  createLocalDomainToolsWithRepository,
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

export function installLocalDomainTools(
  ctx: object,
  ports: LocalDomainToolPorts = {},
): InstalledLocalDomainTools {
  const existing = INSTALLED.get(ctx);
  if (existing) return existing;
  const store = storeOf(ports);
  const deviceId = deviceIdOf(ports);
  const syncQueue = ports.syncQueue ?? createInMemoryLocalSyncQueue();
  const tools = createLocalDomainToolsWithRepository({
    store,
    deviceId,
    syncQueue,
    ...(ports.repository ? { repository: ports.repository } : {}),
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
