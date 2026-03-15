export type ClawMachineProfileInput = {
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

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOptionalPort(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < 1 || value > 65535) return null;
  return value;
}

export function normalizeMachineProfile(value: unknown): ClawMachineProfileInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const profile: ClawMachineProfileInput = {};

  const machineName = normalizeOptionalText(raw.machineName);
  if (machineName) profile.machineName = machineName;
  const machineIp = normalizeOptionalText(raw.machineIp);
  if (machineIp) profile.machineIp = machineIp;
  const rootInstallDirectory = normalizeOptionalText(raw.rootInstallDirectory);
  if (rootInstallDirectory) profile.rootInstallDirectory = rootInstallDirectory;
  const workspaceDirectory = normalizeOptionalText(raw.workspaceDirectory);
  if (workspaceDirectory) profile.workspaceDirectory = workspaceDirectory;
  const gatewayPort = normalizeOptionalPort(raw.gatewayPort);
  if (gatewayPort != null) profile.gatewayPort = gatewayPort;
  const relayPort = normalizeOptionalPort(raw.relayPort);
  if (relayPort != null) profile.relayPort = relayPort;
  const tunnelUrl = normalizeOptionalText(raw.tunnelUrl);
  if (tunnelUrl) profile.tunnelUrl = tunnelUrl;
  const tunnelStatus = normalizeOptionalText(raw.tunnelStatus);
  if (tunnelStatus) profile.tunnelStatus = tunnelStatus;
  if (raw.networkMetadata && typeof raw.networkMetadata === 'object' && !Array.isArray(raw.networkMetadata)) {
    profile.networkMetadata = raw.networkMetadata as Record<string, unknown>;
  }

  return Object.keys(profile).length > 0 ? profile : null;
}

export function classifyContextFiles(paths: string[]): {
  manifestFiles: string[];
  prdFiles: string[];
  taskFiles: string[];
  memoryFiles: string[];
} {
  const manifestFiles = paths.filter((p) => /(manifest\.(ya?ml|json|md)|project\.manifest)/i.test(p));
  const prdFiles = paths.filter((p) => /(^|\/)(prd|prds)(\/|$)|product[-_ ]requirements|requirements\.md/i.test(p));
  const taskFiles = paths.filter((p) => /(^|\/)tasks?(\/|$)|task[-_.].*\.md|backlog/i.test(p));
  const memoryFiles = paths.filter((p) => /(^|\/)(memory|memories|sessions)(\/|$)|session[-_.]handoff/i.test(p));
  return { manifestFiles, prdFiles, taskFiles, memoryFiles };
}
