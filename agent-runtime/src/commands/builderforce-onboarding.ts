import { confirm, note, password, select, spinner, text } from "@clack/prompts";
import { loadProjectContext, updateProjectContextFields } from "../builderforce/project-context.js";
import { buildLocalMachineProfile } from "../infra/builderforce-context.js";
import { readSharedEnvVar, upsertSharedEnvVar } from "../infra/env-file.js";
import { normalizeBaseUrl } from "../utils/normalize-base-url.js";
import { authenticateViaBrowser } from "./browser-auth-server.js";
import { detectBrowserOpenSupport } from "./onboard-helpers.js";

async function builderforceApiFetch<T>(
  url: string,
  opts: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, ...rest } = opts;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const res = await fetch(url, { ...rest, headers });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = (body.error as string) ?? (body.message as string) ?? res.statusText;
    throw new Error(`${res.status} ${msg}`);
  }
  return body as T;
}

async function ensureProjectMapping(params: {
  serverUrl: string;
  tenantJwt: string;
  projectRoot: string;
  projectName: string;
  description?: string;
  agentNodeId: string;
}): Promise<{ projectId: string; action: "created" | "updated" } | null> {
  try {
    const upsert = await builderforceApiFetch<{
      action: "created" | "updated";
      project: { id: string; name: string };
    }>(`${params.serverUrl}/api/projects/upsert`, {
      method: "POST",
      token: params.tenantJwt,
      body: JSON.stringify({
        name: params.projectName,
        description: params.description ?? `Managed from ${params.projectRoot}`,
      }),
    });

    await builderforceApiFetch(
      `${params.serverUrl}/api/agentNodes/${params.agentNodeId}/projects/${upsert.project.id}`,
      {
        method: "PUT",
        token: params.tenantJwt,
      },
    );

    return { projectId: upsert.project.id, action: upsert.action };
  } catch {
    return null;
  }
}

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
    const authMode = await select({
      message: "Do you have a Builderforce account?",
      options: [
        { value: "login", label: "Yes — log in" },
        { value: "register", label: "No  — create a free account" },
      ],
    });
    if (typeof authMode === "symbol") {
      return null;
    }

    const emailInput = await text({ message: "Email:" });
    if (typeof emailInput === "symbol" || !emailInput.trim()) {
      return null;
    }
    const email = emailInput.trim();

    let usernameForReg = "";
    if (authMode === "register") {
      const usernameInput = await text({
        message: "Username:",
        initialValue: params.defaultInstanceName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      });
      if (typeof usernameInput === "symbol" || !usernameInput.trim()) {
        return null;
      }
      usernameForReg = usernameInput.trim();
    }

    const passwordInput = await password({ message: "Password:" });
    if (typeof passwordInput === "symbol" || !passwordInput.trim()) {
      return null;
    }
    const rawPassword = passwordInput.trim();

    const authSpin = spinner();
    try {
      if (authMode === "register") {
        authSpin.start("Creating account…");
        const res = await builderforceApiFetch<{ token: string }>(
          `${serverUrl}/api/auth/web/register`,
          {
            method: "POST",
            body: JSON.stringify({
              email,
              username: usernameForReg,
              password: rawPassword,
            }),
          },
        );
        webToken = res.token;
        authSpin.stop("Account created");
      } else {
        authSpin.start("Authenticating…");
        const res = await builderforceApiFetch<{ token: string }>(
          `${serverUrl}/api/auth/web/login`,
          {
            method: "POST",
            body: JSON.stringify({ email, password: rawPassword }),
          },
        );
        webToken = res.token;
        authSpin.stop("Authenticated");
      }
    } catch (err) {
      authSpin.stop("Authentication failed");
      note(String(err instanceof Error ? err.message : err), "Error");
      return null;
    }
  }

  let tenantId = 0;
  const tenantSpin = spinner();
  tenantSpin.start("Loading workspaces…");
  let tenants: Array<{ id: number; name: string; slug: string }> = [];
  try {
    const res = await builderforceApiFetch<{
      tenants: Array<{ id: number; name: string; slug: string }>;
    }>(`${serverUrl}/api/auth/my-tenants`, { token: webToken });
    tenants = res.tenants;
    tenantSpin.stop(`${tenants.length} workspace(s) found`);
  } catch (err) {
    tenantSpin.stop("Could not load workspaces");
    note(String(err instanceof Error ? err.message : err), "Error");
    return null;
  }

  if (tenants.length === 0) {
    const wsNameInput = await text({
      message: "Create your first workspace:",
      initialValue: params.defaultInstanceName,
    });
    if (typeof wsNameInput === "symbol" || !wsNameInput.trim()) {
      return null;
    }
    const wsSpin = spinner();
    wsSpin.start("Creating workspace…");
    try {
      const created = await builderforceApiFetch<{ id: number; name: string }>(
        `${serverUrl}/api/tenants/create`,
        {
          method: "POST",
          token: webToken,
          body: JSON.stringify({ name: wsNameInput.trim() }),
        },
      );
      tenantId = created.id;
      wsSpin.stop(`Workspace "${created.name}" created`);
    } catch (err) {
      wsSpin.stop("Could not create workspace");
      note(String(err instanceof Error ? err.message : err), "Error");
      return null;
    }
  } else if (tenants.length === 1) {
    tenantId = tenants[0].id;
    note(`Using workspace: ${tenants[0].name}`, "Workspace");
  } else {
    const picked = await select({
      message: "Select workspace:",
      options: tenants.map((tenant) => ({
        value: tenant.id,
        label: tenant.name,
        hint: tenant.slug,
      })),
    });
    if (typeof picked === "symbol") {
      return null;
    }
    tenantId = picked;
  }

  let tenantJwt = "";
  try {
    const res = await builderforceApiFetch<{ token: string }>(
      `${serverUrl}/api/auth/tenant-token`,
      {
        method: "POST",
        token: webToken,
        body: JSON.stringify({ tenantId }),
      },
    );
    tenantJwt = res.token;
  } catch (err) {
    note(String(err instanceof Error ? err.message : err), "Could not get workspace token");
    return null;
  }

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
      agentNode: { id: number; name: string; slug: string };
      apiKey: string;
    }>(`${serverUrl}/api/agentNodes`, {
      method: "POST",
      token: tenantJwt,
      body: JSON.stringify({ name: agentNodeName, machineProfile }),
    });
    agentNodeId = String(res.agentNode.id);
    agentNodeSlug = res.agentNode.slug;
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

    agentNodeSpin.stop(`AgentNode "${res.agentNode.name}" registered`);
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
