import os from "node:os";
import type { ProjectContext } from "../builderforce/types.js";

export type RelayMachineProfile = {
  machineName?: string;
  machineIp?: string;
  rootInstallDirectory?: string;
  workspaceDirectory?: string;
  gatewayPort?: number;
  relayPort?: number;
  tunnelUrl?: string;
  tunnelStatus?: string;
  networkMetadata?: Record<string, unknown>;
};

export type AssignmentContextResponse = {
  agentNode?: {
    machineProfile?: RelayMachineProfile | null;
  };
  primaryProject?: {
    id?: number;
    key?: string;
    name?: string;
    rootWorkingDirectory?: string | null;
    directoryPath?: string | null;
    contextHints?: {
      manifestFiles?: string[];
      prdFiles?: string[];
      taskFiles?: string[];
      memoryFiles?: string[];
    };
  } | null;
  syncedAt?: string;
};

export function detectPrimaryMachineIp(): string | undefined {
  const all = os.networkInterfaces();
  for (const addresses of Object.values(all)) {
    if (!addresses) {
      continue;
    }
    for (const addr of addresses) {
      if (addr.family === "IPv4" && !addr.internal) {
        return addr.address;
      }
    }
  }
  return undefined;
}

export function buildLocalMachineProfile(params: {
  workspaceDirectory?: string;
  rootInstallDirectory?: string;
  gatewayPort?: number;
  relayPort?: number;
  tunnelUrl?: string;
  tunnelStatus?: string;
}): RelayMachineProfile {
  return {
    machineName: os.hostname(),
    machineIp: detectPrimaryMachineIp(),
    rootInstallDirectory: params.rootInstallDirectory,
    workspaceDirectory: params.workspaceDirectory,
    gatewayPort: params.gatewayPort,
    relayPort: params.relayPort,
    tunnelUrl: params.tunnelUrl,
    tunnelStatus: params.tunnelStatus,
    networkMetadata: {
      platform: process.platform,
      release: os.release(),
    },
  };
}

export function mergeBuilderforceContext(params: {
  existing: ProjectContext["builderforce"] | undefined;
  assignmentContext: AssignmentContextResponse;
  fallback: { instanceId: string; url: string };
  machineProfile: RelayMachineProfile;
}): NonNullable<ProjectContext["builderforce"]> {
  const existing = params.existing ?? { instanceId: params.fallback.instanceId };
  const primary = params.assignmentContext.primaryProject;

  return {
    ...existing,
    instanceId: existing.instanceId || params.fallback.instanceId,
    url: existing.url ?? params.fallback.url,
    ...(primary?.id != null ? { projectId: String(primary.id) } : {}),
    machineProfile: {
      ...existing.machineProfile,
      ...params.machineProfile,
      ...params.assignmentContext.agentNode?.machineProfile,
    },
    assignmentContext: {
      syncedAt: params.assignmentContext.syncedAt ?? new Date().toISOString(),
      project: primary
        ? {
            id: primary.id != null ? String(primary.id) : undefined,
            key: primary.key,
            name: primary.name,
            rootWorkingDirectory: primary.rootWorkingDirectory ?? undefined,
            directoryPath: primary.directoryPath ?? undefined,
          }
        : undefined,
      contextHints: {
        manifestFiles: primary?.contextHints?.manifestFiles ?? [],
        prdFiles: primary?.contextHints?.prdFiles ?? [],
        taskFiles: primary?.contextHints?.taskFiles ?? [],
        memoryFiles: primary?.contextHints?.memoryFiles ?? [],
      },
    },
  };
}
