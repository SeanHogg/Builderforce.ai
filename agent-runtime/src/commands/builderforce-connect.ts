/**
 * Headless agent-host connect — the non-interactive counterpart to the
 * interactive `promptBuilderforceOnboarding` flow. It registers THIS machine as
 * an agent host in a Builderforce workspace using a workspace token, then writes
 * the link credentials (`~/.builderforce/.env`) and project context so a
 * subsequent `builderforce gateway` connects straight into the workgroup.
 *
 * This is what the "Connect a new agent" one-liner on /workforce drives:
 *   $env:BUILDERFORCE_TOKEN=...; $env:BUILDERFORCE_WORKSPACE=...; (install) ; builderforce connect
 */
import os from "node:os";
import { updateProjectContextFields } from "../builderforce/project-context.js";
import { buildLocalMachineProfile } from "../infra/builderforce-context.js";
import { upsertSharedEnvVar } from "../infra/env-file.js";
import { normalizeBaseUrl } from "../utils/normalize-base-url.js";

const DEFAULT_API_URL = "https://api.builderforce.ai";

export interface ConnectAgentHeadlessParams {
  /** Workspace JWT (from $BUILDERFORCE_TOKEN). Scopes the tenant + authorizes registration. */
  token: string;
  /** Builderforce API base URL. Default: $BUILDERFORCE_URL or https://api.builderforce.ai */
  apiUrl?: string;
  /** Display name for this agent host. Default: machine hostname. */
  name?: string;
  /** Project root whose context to update. Default: process.cwd(). */
  projectRoot?: string;
}

export interface ConnectAgentHeadlessResult {
  id: string;
  slug?: string;
  name: string;
  apiUrl: string;
}

/** Best-effort decode of the `tid` (tenant id) claim from a JWT payload. */
function decodeTenantId(jwt: string): number | undefined {
  try {
    const part = jwt.split(".")[1];
    if (!part) return undefined;
    const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const payload = JSON.parse(json) as { tid?: number };
    return typeof payload.tid === "number" ? payload.tid : undefined;
  } catch {
    return undefined;
  }
}

export async function connectAgentHeadless(
  params: ConnectAgentHeadlessParams,
): Promise<ConnectAgentHeadlessResult> {
  const token = params.token?.trim();
  if (!token) {
    throw new Error("A workspace token is required (set BUILDERFORCE_TOKEN or pass --token).");
  }
  const apiUrl = normalizeBaseUrl(params.apiUrl?.trim() || DEFAULT_API_URL);
  const projectRoot = params.projectRoot ?? process.cwd();
  const name = (params.name ?? os.hostname()).trim() || os.hostname();

  const machineProfile = buildLocalMachineProfile({
    workspaceDirectory: projectRoot,
    rootInstallDirectory: process.cwd(),
    gatewayPort: 18789,
    tunnelUrl: process.env.BUILDERFORCE_AGENTS_PUBLIC_TUNNEL_URL,
    tunnelStatus: process.env.BUILDERFORCE_AGENTS_PUBLIC_TUNNEL_URL ? "connected" : "none",
  });

  // Register against the SERVER contract: POST /api/agent-hosts -> { agentHost, apiKey }.
  const res = await fetch(`${apiUrl}/api/agent-hosts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, machineProfile }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    agentHost?: { id: number | string; name?: string; slug?: string };
    apiKey?: string;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(`Registration failed (${res.status}): ${body.error ?? res.statusText}`);
  }
  if (!body.agentHost?.id || !body.apiKey) {
    throw new Error("Unexpected response from /api/agent-hosts (missing agentHost or apiKey).");
  }
  const id = String(body.agentHost.id);

  // Persist link credentials where the gateway/relay read them (~/.builderforce/.env).
  upsertSharedEnvVar({ key: "BUILDERFORCE_URL", value: apiUrl });
  upsertSharedEnvVar({ key: "BUILDERFORCE_API_KEY", value: body.apiKey });

  // The gateway resolves its own host id from project context, so write it.
  const tenantId = decodeTenantId(token);
  try {
    await updateProjectContextFields(projectRoot, {
      builderforce: {
        instanceId: id,
        instanceSlug: body.agentHost.slug,
        instanceName: body.agentHost.name ?? name,
        ...(tenantId != null ? { tenantId } : {}),
        url: apiUrl,
        machineProfile,
      },
    });
  } catch {
    // Context write is best-effort; the API key in ~/.builderforce/.env is the source of truth.
  }

  return { id, slug: body.agentHost.slug, name: body.agentHost.name ?? name, apiUrl };
}
