/**
 * Workforce Agent — install and manage custom trained agents from the
 * Builderforce Workforce Registry inside a builderForceAgents project.
 *
 * CLI surface:
 *   builderforce agent install <agentId|registryUrl>
 *   builderforce agent info
 *   builderforce agent remove
 */

import { note, outro, spinner } from "@clack/prompts";
import { saveMambaState } from "../agents/mamba-state-engine.js";
import { loadProjectContext, updateProjectContextFields } from "../builderforce/project-context.js";
import type { AgentPackage, AgentPackageV2, InstalledWorkforceAgent } from "../builderforce/types.js";
import { readSharedEnvVar } from "../infra/env-file.js";
import { theme } from "../terminal/theme.js";
import { fetchWithTimeout } from "../utils/fetch-timeout.js";
import { normalizeBaseUrl } from "../utils/normalize-base-url.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_REGISTRY_URL = "https://api.builderforce.ai";
const FETCH_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveRegistryUrl(): string {
  return normalizeBaseUrl(readSharedEnvVar("BUILDERFORCE_AGENTS_LINK_URL") ?? DEFAULT_REGISTRY_URL);
}

function resolveAuthHeaders(): Record<string, string> {
  const apiKey = readSharedEnvVar("BUILDERFORCE_AGENTS_LINK_API_KEY");
  if (!apiKey) {
    return {};
  }
  return { Authorization: `Bearer ${apiKey}` };
}

function isV2Package(pkg: AgentPackage): pkg is AgentPackageV2 {
  return pkg.version === "2.0";
}

// ---------------------------------------------------------------------------
// Registry API
// ---------------------------------------------------------------------------

/**
 * Download the agent package JSON from the Workforce Registry.
 * Throws a descriptive error on non-2xx or network failure.
 */
export async function fetchAgentPackage(params: {
  agentId: string;
  registryUrl?: string;
}): Promise<AgentPackage> {
  const base = normalizeBaseUrl(params.registryUrl ?? resolveRegistryUrl());
  const url = `${base}/api/agents/${encodeURIComponent(params.agentId)}/package`;
  let res: Response;
  try {
    res = await fetchWithTimeout(
      url,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...resolveAuthHeaders(),
        },
      },
      FETCH_TIMEOUT_MS,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Network error fetching agent package: ${msg}`, { cause: err });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Registry returned ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`);
  }

  const pkg = (await res.json()) as AgentPackage;
  if (!pkg.version || !pkg.platform || !pkg.name || !pkg.base_model) {
    throw new Error(
      "Invalid agent package: missing required fields (version, platform, name, base_model)",
    );
  }
  return pkg;
}

// ---------------------------------------------------------------------------
// Model reference resolver
// ---------------------------------------------------------------------------

/**
 * Build the builderForceAgents model reference for a Workforce agent.
 *
 * If the user has BuilderForceAgentsLLM configured, route inference through the
 * managed proxy endpoint that loads the LoRA adapter on demand:
 *   builderforcellm/workforce-<agentId>
 *
 * Otherwise fall back to the base model through the default provider.
 */
export function resolveWorkforceModelRef(params: { agentId: string; pkg: AgentPackage }): string {
  const linkedKey = readSharedEnvVar("BUILDERFORCE_AGENTS_LINK_API_KEY");
  if (linkedKey) {
    return `builderforcellm/workforce-${params.agentId}`;
  }
  // Fall back to the base model ID — the user must ensure they have a
  // provider configured that can serve it (e.g. Ollama or vLLM locally).
  return params.pkg.base_model;
}

// ---------------------------------------------------------------------------
// Install command
// ---------------------------------------------------------------------------

/**
 * Install a Workforce agent into the current project.
 *
 * Downloads the agent package from the Builderforce registry and writes the
 * metadata into `.builderforce/context.yaml` so builderForceAgents sessions can use the
 * agent's custom LLM automatically.
 *
 * @returns A short human-readable summary of what was done.
 */
export async function installWorkforceAgent(params: {
  agentId: string;
  projectRoot: string;
  registryUrl?: string;
}): Promise<string> {
  const registryUrl = params.registryUrl ?? resolveRegistryUrl();

  const spin = spinner();
  spin.start(`Fetching agent package for "${params.agentId}" from ${registryUrl}…`);

  let pkg: AgentPackage;
  try {
    pkg = await fetchAgentPackage({ agentId: params.agentId, registryUrl });
    spin.stop(`Package downloaded: ${pkg.name} (v${pkg.version})`);
  } catch (err) {
    spin.stop("Failed to download agent package");
    throw err;
  }

  const modelRef = resolveWorkforceModelRef({ agentId: params.agentId, pkg });
  const hasMambaState = isV2Package(pkg) && Boolean(pkg.mamba_state);

  const installed: InstalledWorkforceAgent = {
    agentId: params.agentId,
    name: pkg.name,
    title: pkg.title,
    baseModel: pkg.base_model,
    modelRef,
    loraArtifactKey: pkg.r2_artifact_key,
    packageVersion: pkg.version,
    hasMambaState,
    installedAt: new Date().toISOString(),
    registryUrl,
  };

  // Write into project context so the session banner and TUI pick it up
  await updateProjectContextFields(params.projectRoot, {
    customAgent: installed,
    // Also set the default LLM so all inference paths route to this agent
    llm: { provider: "builderforcellm", model: modelRef },
  });

  // Persist the v2 mamba state snapshot to disk so inference can inject it as memory context
  if (hasMambaState && isV2Package(pkg) && pkg.mamba_state) {
    await saveMambaState(params.projectRoot, pkg.mamba_state);
  }

  return [
    `Workforce agent installed: ${pkg.name} (${params.agentId})`,
    `  Base model:   ${pkg.base_model}`,
    `  Package:      v${pkg.version}`,
    `  Mamba state:  ${hasMambaState ? "yes (persistent memory)" : "no"}`,
    `  Model ref:    ${modelRef}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Info command
// ---------------------------------------------------------------------------

/**
 * Print info about the currently installed Workforce agent for a project.
 * Returns null when no agent is installed.
 */
export async function showWorkforceAgentInfo(projectRoot: string): Promise<void> {
  const ctx = await loadProjectContext(projectRoot);
  if (!ctx?.customAgent) {
    note(
      "No Workforce agent is installed in this project.\n\nRun: builderforce agent install <agentId>",
      "No agent installed",
    );
    return;
  }

  const a = ctx.customAgent;
  const lines = [
    theme.heading("Workforce Agent"),
    `  ID:           ${a.agentId}`,
    `  Name:         ${a.name}${a.title ? ` — ${a.title}` : ""}`,
    `  Base model:   ${a.baseModel}`,
    `  Model ref:    ${a.modelRef}`,
    `  Package:      v${a.packageVersion}`,
    `  Mamba state:  ${a.hasMambaState ? "yes (persistent memory)" : "no"}`,
    `  Installed:    ${a.installedAt}`,
    `  Registry:     ${a.registryUrl}`,
  ].join("\n");

  note(lines, "Installed Agent");
}

// ---------------------------------------------------------------------------
// Remove command
// ---------------------------------------------------------------------------

/**
 * Remove the installed Workforce agent from the project's context.
 */
export async function removeWorkforceAgent(projectRoot: string): Promise<void> {
  const ctx = await loadProjectContext(projectRoot);
  if (!ctx?.customAgent) {
    note("No Workforce agent is installed in this project.", "Nothing to remove");
    return;
  }

  const name = ctx.customAgent.name;
  // Clear the customAgent field and revert llm to the default BuilderForceAgentsLLM auto model
  await updateProjectContextFields(projectRoot, {
    customAgent: undefined,
    llm: { provider: "builderforcellm", model: "builderforcellm/auto" },
  });
  outro(theme.success(`Workforce agent "${name}" removed. Reverted to builderforcellm/auto.`));
}
