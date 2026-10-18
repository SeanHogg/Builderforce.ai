import { confirm, note, select, spinner, text } from "@clack/prompts";
import { loadProjectContext, updateProjectContextFields } from "../builderforce/project-context.js";
import { buildLocalMachineProfile } from "../infra/builderforce-context.js";
import { readSharedEnvVar, upsertSharedEnvVar } from "../infra/env-file.js";
import { normalizeBaseUrl } from "../utils/normalize-base-url.js";
import { authenticateViaBrowser } from "./browser-auth-server.js";
import {
  authenticateWithPassword,
  builderforceApiFetch,
  ensureProjectMapping,
  selectTenantAndToken,
} from "./builderforce-api.js";
import { detectBrowserOpenSupport } from "./onboard-helpers.js";

export async function promptBuilderforceOnboarding(params: {
  projectRoot: string;
  defaultInstanceName: string;
  forcePrompt?: boolean;
}): Promise<string | null> {
  const existingKey = readSharedEnvVar("BUILDERFORCE_API_KEY");
  if (existingKey) {
    const existingUrl = readSharedEnvVar("BUILDERFORCE_URL") ?? "https://api.builderforce.ai";
    const existingTenantId = readSharedEnvVar("BUILDERFORCE_TENANT_ID");
    const existingCtx = await loadProjectContext(params.projectRoot).catch(() => null);
    const agentNodeLabel =
      existingCtx?.builderforce?.instanceSlug ??
      existingCtx?.builderforce?.instanceName ??
      existingCtx?.builderforce?.instanceId ??
      "(registered)";
    note(
      [
        `URL:    ${existingUrl}`,
        `Tenant: ${existingTenantId ?? "unknown"}`,
        `AgentNode:   ${agentNodeLabel}`,
        "",
        "Run 'builderforce init --reconnect' to link a different account.",
      ].join("\n"),
      "Already connected to Builderforce",
    );
    return `Builderforce: already connected (${existingUrl})`;
  }

  if (!params.forcePrompt) {
    const skipped = readSharedEnvVar("BUILDERFORCE_SKIPPED");
    if (skipped === "1") {
      return null;
    }
  }

  const connect = await confirm({
    message:
      "Connect to Builderforce? (optional — manage projects, tasks & agents across your mesh)",
    initialValue: true,
  });
  if (typeof connect === "symbol" || !connect) {
    upsertSharedEnvVar({ key: "BUILDERFORCE_SKIPPED", value: "1" });
    return null;
  }

  const urlInput = await text({
    message: "Orchestration API URL (Builderforce):",
    initialValue: "https://api.builderforce.ai",
  });
  if (typeof urlInput === "symbol") {
    return null;
  }
  const serverUrl = normalizeBaseUrl(urlInput.trim()) || "https://api.builderforce.ai";

  // ── Authentication ─────────────────────────────────────────────────────
  // Prefer browser-based auth when a display is available.
  const browserOk = (await detectBrowserOpenSupport()).ok;
  const authMethod = browserOk
    ? await select({
        message: "How would you like to authenticate?",
        options: [
          {
            value: "browser",
            label: "Open browser  (recommended)",
            hint: "login or register in your browser",
          },
          {
            value: "terminal",
            label: "Type here",
            hint: "enter email & password in this terminal",
          },
        ],
      })
    : "terminal";
  if (typeof authMethod === "symbol") {
    return null;
  }

  let webToken = "";

  if (authMethod === "browser") {
    // Wrap the @clack/prompts API into the WizardPrompter shape the browser
    // auth module expects (only note + text are used).
    const prompter = {
      note: async (msg: string, title?: string) => {
        note(msg, title);
      },
      text: (opts: { message: string; validate?: (v: string) => string | undefined }) =>
        text({
          ...opts,
          validate: opts.validate
            ? (value: string | undefined) => opts.validate!(value ?? "")
            : undefined,
        }),
    } as Parameters<typeof authenticateViaBrowser>[0]["prompter"];

    const result = await authenticateViaBrowser({ serverUrl, prompter });
    if (!result) {
      return null;
    }
    webToken = result.webToken;
  } else {
    const token = await authenticateWithPassword({
      serverUrl,
      defaultInstanceName: params.defaultInstanceName,
    });
    if (!token) {
      return null;
    }
    webToken = token;
  }

  const tenant = await selectTenantAndToken({
    serverUrl,
    webToken,
    defaultInstanceName: params.defaultInstanceName,
  });
  if (!tenant) {
    return null;
  }
  const { tenantId, tenantJwt } = tenant;

  const agentNodeNameInput = await text({
    message: "AgentNode instance name (shown in dashboard):",
    initialValue: params.defaultInstanceName,
  });
  if (typeof agentNodeNameInput === "symbol") {
    return null;
  }
  const agentNodeName = agentNodeNameInput.trim() || params.defaultInstanceName;

  const agentNodeSpin = spinner();
  agentNodeSpin.start("Registering agentNode instance…");
  let agentNodeId = "";
  let agentNodeSlug = "";
  let apiKey = "";
  let projectId = "";
  let projectAction: "created" | "updated" | "unknown" = "unknown";
  const machineProfile = buildLocalMachineProfile({
    workspaceDirectory: params.projectRoot,
    rootInstallDirectory: process.cwd(),
    gatewayPort: 18789,
    tunnelUrl: process.env.BUILDERFORCE_AGENTS_PUBLIC_TUNNEL_URL,
    tunnelStatus: process.env.BUILDERFORCE_AGENTS_PUBLIC_TUNNEL_URL ? "connected" : "none",
  });
  try {
    const res = await builderforceApiFetch<{
      agentHost: { id: number; name: string; slug: string };
      apiKey: string;
    }>(`${serverUrl}/api/agent-hosts`, {
      method: "POST",
      token: tenantJwt,
      body: JSON.stringify({ name: agentNodeName, machineProfile }),
    });
    agentNodeId = String(res.agentHost.id);
    agentNodeSlug = res.agentHost.slug;
    apiKey = res.apiKey;

    const mapped = await ensureProjectMapping({
      serverUrl,
      tenantJwt,
      agentNodeId,
      projectRoot: params.projectRoot,
      projectName: params.defaultInstanceName,
      description: `builderForceAgents project at ${params.projectRoot}`,
    });
    if (mapped) {
      projectId = mapped.projectId;
      projectAction = mapped.action;
    }

    agentNodeSpin.stop(`AgentNode "${res.agentHost.name}" registered`);
  } catch (err) {
    agentNodeSpin.stop("AgentNode registration failed");
    note(String(err instanceof Error ? err.message : err), "Error");
    return null;
  }

  upsertSharedEnvVar({ key: "BUILDERFORCE_URL", value: serverUrl });
  upsertSharedEnvVar({ key: "BUILDERFORCE_WEB_TOKEN", value: webToken });
  upsertSharedEnvVar({ key: "BUILDERFORCE_TENANT_ID", value: String(tenantId) });
  upsertSharedEnvVar({ key: "BUILDERFORCE_API_KEY", value: apiKey });
  upsertSharedEnvVar({ key: "BUILDERFORCE_SKIPPED", value: "0" });

  try {
    await updateProjectContextFields(params.projectRoot, {
      builderforce: {
        instanceId: agentNodeId,
        instanceSlug: agentNodeSlug,
        instanceName: agentNodeName,
        ...(projectId ? { projectId } : {}),
        tenantId,
        url: serverUrl,
        machineProfile,
      },
    });
  } catch {}

  note(
    [
      "AgentNode API key saved to ~/.builderforce/.env",
      "This key was shown once — it is hashed on the server.",
      `Instance slug: ${agentNodeSlug}  ·  tenant: ${tenantId}`,
      projectId ? `Project ${projectAction}: ${projectId}` : "Project mapping: not available",
    ].join("\n"),
    "Builderforce connected",
  );

  return `Builderforce: ${agentNodeName} (${agentNodeSlug}) on tenant ${tenantId}`;
}
