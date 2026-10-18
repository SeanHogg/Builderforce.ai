/**
 * Builderforce connection-wizard primitives shared by `builderforce init`
 * (builderforce.ts) and the onboarding prompt (builderforce-onboarding.ts):
 * the HTTP wrapper plus the login -> tenant -> tenant-token -> project-mapping
 * steps. One copy so the two wizards cannot drift.
 */
import { note, password, select, spinner, text } from "@clack/prompts";

/**
 * The API answers errors as flat `{error:"msg"}` or nested
 * `{error:{message,code,details}}`. Reading `error` as a string only renders
 * "[object Object]" for the nested form. Same rule as the web client's
 * flattenErrorBody and the Chrome client's copy (no package all three runtimes
 * can import, so one copy per runtime).
 */
export function flattenErrorMessage(body: Record<string, unknown>): string | undefined {
  const err = body.error;
  const nested = typeof err === "object" && err !== null ? (err as { message?: unknown }) : null;
  const candidates = [body.message, nested?.message, err];
  return candidates.find((c): c is string => typeof c === "string" && c.length > 0);
}

/** Thin fetch wrapper — throws a descriptive error on non-2xx. */
export async function builderforceApiFetch<T>(
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
    throw new Error(`${res.status} ${flattenErrorMessage(body) ?? res.statusText}`);
  }
  return body as T;
}

export async function ensureProjectMapping(params: {
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
      `${params.serverUrl}/api/agent-hosts/${params.agentNodeId}/projects/${upsert.project.id}`,
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

/** Terminal login/register prompt chain. Returns the web token, or null if cancelled/failed. */
export async function authenticateWithPassword(params: {
  serverUrl: string;
  defaultInstanceName: string;
}): Promise<string | null> {
  const { serverUrl, defaultInstanceName } = params;
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
    const unInput = await text({
      message: "Username:",
      initialValue: defaultInstanceName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    });
    if (typeof unInput === "symbol" || !unInput.trim()) {
      return null;
    }
    usernameForReg = unInput.trim();
  }

  const pwdInput = await password({ message: "Password:" });
  if (typeof pwdInput === "symbol" || !pwdInput.trim()) {
    return null;
  }
  const pwd = pwdInput.trim();

  const authSpin = spinner();
  try {
    if (authMode === "register") {
      authSpin.start("Creating account…");
      const res = await builderforceApiFetch<{ token: string }>(
        `${serverUrl}/api/auth/web/register`,
        {
          method: "POST",
          body: JSON.stringify({ email, username: usernameForReg, password: pwd }),
        },
      );
      authSpin.stop("Account created");
      return res.token;
    }
    authSpin.start("Authenticating…");
    const res = await builderforceApiFetch<{ token: string }>(`${serverUrl}/api/auth/web/login`, {
      method: "POST",
      body: JSON.stringify({ email, password: pwd }),
    });
    authSpin.stop("Authenticated");
    return res.token;
  } catch (err) {
    authSpin.stop("Authentication failed");
    note(String(err instanceof Error ? err.message : err), "Error");
    return null;
  }
}

/** Pick (or create the first) workspace, then exchange the web token for a tenant JWT. */
export async function selectTenantAndToken(params: {
  serverUrl: string;
  webToken: string;
  defaultInstanceName: string;
}): Promise<{ tenantId: number; tenantJwt: string } | null> {
  const { serverUrl, webToken, defaultInstanceName } = params;
  let tenantId = 0;
  const tenantSpin = spinner();
  tenantSpin.start("Loading workspaces…");
  let tenants: Array<{ id: number; name: string; slug: string }> = [];
  try {
    const res = await builderforceApiFetch<{
      tenants: Array<{ id: number; name: string; slug: string }>;
    }>(`${serverUrl}/api/tenants`, { token: webToken });
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
      initialValue: defaultInstanceName,
    });
    if (typeof wsNameInput === "symbol" || !wsNameInput.trim()) {
      return null;
    }
    const wsSpin = spinner();
    wsSpin.start("Creating workspace…");
    try {
      const created = await builderforceApiFetch<{ id: number; name: string }>(
        `${serverUrl}/api/tenants`,
        { method: "POST", token: webToken, body: JSON.stringify({ name: wsNameInput.trim() }) },
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
      options: tenants.map((t) => ({ value: t.id, label: t.name, hint: t.slug })),
    });
    if (typeof picked === "symbol") {
      return null;
    }
    tenantId = picked;
  }

  try {
    const res = await builderforceApiFetch<{ token: string }>(`${serverUrl}/api/auth/tenant-token`, {
      method: "POST",
      token: webToken,
      body: JSON.stringify({ tenantId }),
    });
    return { tenantId, tenantJwt: res.token };
  } catch (err) {
    note(String(err instanceof Error ? err.message : err), "Could not get workspace token");
    return null;
  }
}
