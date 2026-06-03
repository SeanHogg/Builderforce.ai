/**
 * CLI command for initializing builderForceAgents projects
 */

import fs from "node:fs/promises";
import path from "node:path";
import { confirm, intro, note, outro, password, select, spinner, text } from "@clack/prompts";
import { Command } from "commander";
import {
  initializeBuilderForceAgentsProject,
  isBuilderForceAgentsProject,
  loadProjectContext,
  updateProjectContextFields,
} from "../builderforce/project-context.js";
import { readConfigFileSnapshot, writeConfigFile } from "../config/config.js";
import { upsertSharedEnvVar, readSharedEnvVar } from "../infra/env-file.js";
import { theme } from "../terminal/theme.js";
import { runTui } from "../tui/tui.js";
import { normalizeBaseUrl } from "../utils/normalize-base-url.js";
import { VERSION } from "../version.js";
import {
  setAnthropicApiKey,
  setGeminiApiKey,
  setOpenrouterApiKey,
} from "./onboard-auth.credentials.js";
import {
  installWorkforceAgent,
  showWorkforceAgentInfo,
  removeWorkforceAgent,
  DEFAULT_REGISTRY_URL,
} from "./workforce-agent.js";

// ---------------------------------------------------------------------------
// Persistent session
// ---------------------------------------------------------------------------

/**
 * Launches the builderForceAgents interactive session — the Claude Code-style experience.
 * Shows a project-aware banner then hands off to the full TUI REPL.
 * The TUI stays open until the user presses Ctrl+C.
 */
export async function runBuilderForceAgentsSession(
  projectRoot: string,
  opts: { message?: string } = {},
): Promise<void> {
  const context = await loadProjectContext(projectRoot);
  const cwd = projectRoot === process.cwd() ? projectRoot : `${projectRoot} (${process.cwd()})`;

  // ── Banner (version · model · cwd) ──────────────────────────────────────
  const lines: string[] = [theme.heading("builderForceAgents") + " " + theme.muted(VERSION)];
  if (context?.llm) {
    lines.push(theme.muted(`  ${context.llm.provider} \u00b7 ${context.llm.model}`));
  }
  if (context?.builderforce) {
    const label =
      context.builderforce.instanceSlug ??
      context.builderforce.instanceName ??
      context.builderforce.instanceId;
    lines.push(theme.muted(`  \u{1F517} Builderforce \u00b7 ${label}`));
  }
  lines.push(theme.muted(`  ${cwd}`));
  if (context?.projectName && context.projectName !== path.basename(projectRoot)) {
    lines.push(theme.accentDim(`  ${context.projectName}`));
  }
  lines.push(theme.muted("  type a message, /help for commands, Ctrl+C to exit"));
  process.stdout.write(lines.join("\n") + "\n\n");

  await runTui({ message: opts.message });
}

// ---------------------------------------------------------------------------
// Auto-detection helpers
// ---------------------------------------------------------------------------

interface DetectedProjectInfo {
  projectName: string;
  description: string;
  languages: string[];
  frameworks: string[];
  buildSystem?: string;
  testFramework?: string;
  lintingTools: string[];
}

async function readJsonFile(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Walk one level of the project to count file extensions → infer languages */
async function detectLanguagesFromFiles(projectRoot: string): Promise<string[]> {
  const extLangMap: Record<string, string> = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".py": "python",
    ".go": "go",
    ".rs": "rust",
    ".java": "java",
    ".kt": "kotlin",
    ".swift": "swift",
    ".rb": "ruby",
    ".php": "php",
    ".cs": "csharp",
    ".cpp": "cpp",
    ".c": "c",
    ".dart": "dart",
    ".ex": "elixir",
    ".exs": "elixir",
    ".hs": "haskell",
  };

  const counts: Record<string, number> = {};
  const ignoreDirs = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    ".builderForceAgents",
    "__pycache__",
    ".next",
    "out",
    "coverage",
    "vendor",
  ]);

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 3) {
      return;
    }
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!ignoreDirs.has(entry.name) && !entry.name.startsWith(".")) {
          await walk(path.join(dir, entry.name), depth + 1);
        }
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        const lang = extLangMap[ext];
        if (lang) {
          counts[lang] = (counts[lang] ?? 0) + 1;
        }
      }
    }
  }

  await walk(projectRoot, 0);

  // Return langs sorted by file count (most common first), deduplicated
  return Object.entries(counts)
    .toSorted((a, b) => b[1] - a[1])
    .map(([lang]) => lang);
}

/** Infer frameworks from package.json deps or well-known config files */
async function detectFrameworks(
  projectRoot: string,
  pkgDeps: Record<string, unknown>,
): Promise<string[]> {
  const found: string[] = [];
  const all = Object.keys(pkgDeps);

  const frameworkMap: Array<[string | RegExp, string]> = [
    ["next", "next.js"],
    ["nuxt", "nuxt"],
    [/^@remix-run/, "remix"],
    ["astro", "astro"],
    ["@sveltejs/kit", "sveltekit"],
    ["svelte", "svelte"],
    ["react", "react"],
    ["vue", "@vue"],
    ["angular", "angular"],
    ["express", "express"],
    ["fastify", "fastify"],
    ["hono", "hono"],
    ["koa", "koa"],
    ["nest", "nestjs"],
    [/^@nestjs/, "nestjs"],
    ["trpc", "trpc"],
    [/^@trpc/, "trpc"],
    ["drizzle-orm", "drizzle"],
    ["prisma", "prisma"],
    [/^@prisma/, "prisma"],
    ["mongoose", "mongoose"],
    ["typeorm", "typeorm"],
    ["django", "django"],
    ["flask", "flask"],
    ["fastapi", "fastapi"],
    ["tailwindcss", "tailwind"],
  ];

  for (const [match, label] of frameworkMap) {
    if (found.includes(label)) {
      continue;
    }
    if (typeof match === "string") {
      if (all.some((k) => k === match || k.startsWith(`${match}/`) || k.startsWith(`@${match}/`))) {
        found.push(label);
      }
    } else {
      if (all.some((k) => match.test(k))) {
        found.push(label);
      }
    }
  }

  // Config-file based detection
  const configChecks: Array<[string, string]> = [
    ["next.config.js", "next.js"],
    ["next.config.ts", "next.js"],
    ["nuxt.config.ts", "nuxt"],
    ["astro.config.mjs", "astro"],
    ["astro.config.ts", "astro"],
    ["svelte.config.js", "sveltekit"],
    ["vite.config.ts", "vite"],
    ["vite.config.js", "vite"],
    ["angular.json", "angular"],
    ["remix.config.js", "remix"],
    ["tailwind.config.ts", "tailwind"],
    ["tailwind.config.js", "tailwind"],
  ];

  for (const [file, label] of configChecks) {
    if (!found.includes(label) && (await fileExists(path.join(projectRoot, file)))) {
      found.push(label);
    }
  }

  return [...new Set(found)];
}

/** Infer test framework from deps / config files */
async function detectTestFramework(
  projectRoot: string,
  pkgDeps: Record<string, unknown>,
): Promise<string | undefined> {
  const all = Object.keys(pkgDeps);
  if (all.includes("vitest")) {
    return "vitest";
  }
  if (all.includes("jest") || all.some((k) => k.startsWith("@jest/"))) {
    return "jest";
  }
  if (all.includes("mocha")) {
    return "mocha";
  }
  if (all.includes("jasmine")) {
    return "jasmine";
  }
  if (all.includes("ava")) {
    return "ava";
  }
  if (all.includes("pytest") || (await fileExists(path.join(projectRoot, "pytest.ini")))) {
    return "pytest";
  }
  if (await fileExists(path.join(projectRoot, "vitest.config.ts"))) {
    return "vitest";
  }
  if (await fileExists(path.join(projectRoot, "jest.config.js"))) {
    return "jest";
  }
  if (await fileExists(path.join(projectRoot, "jest.config.ts"))) {
    return "jest";
  }
  return undefined;
}

/** Infer linting tools */
async function detectLintingTools(
  projectRoot: string,
  pkgDeps: Record<string, unknown>,
): Promise<string[]> {
  const tools: string[] = [];
  const all = Object.keys(pkgDeps);

  if (all.includes("eslint") || (await fileExists(path.join(projectRoot, ".eslintrc.js")))) {
    tools.push("eslint");
  }
  if (all.includes("oxlint")) {
    tools.push("oxlint");
  }
  if (all.includes("prettier") || (await fileExists(path.join(projectRoot, ".prettierrc")))) {
    tools.push("prettier");
  }
  if (all.includes("biome")) {
    tools.push("biome");
  }
  if (all.includes("ruff") || (await fileExists(path.join(projectRoot, "ruff.toml")))) {
    tools.push("ruff");
  }
  if (all.includes("pylint")) {
    tools.push("pylint");
  }

  return tools;
}

/** Infer build system */
async function detectBuildSystem(
  projectRoot: string,
  pkgDeps: Record<string, unknown>,
): Promise<string | undefined> {
  const all = Object.keys(pkgDeps);
  if (all.includes("turbo")) {
    return "turborepo";
  }
  if (all.includes("nx")) {
    return "nx";
  }
  if (all.includes("tsdown") || all.includes("tsup")) {
    return all.includes("tsdown") ? "tsdown" : "tsup";
  }
  if (all.includes("vite")) {
    return "vite";
  }
  if (all.includes("webpack")) {
    return "webpack";
  }
  if (all.includes("rollup")) {
    return "rollup";
  }
  if (all.includes("esbuild")) {
    return "esbuild";
  }
  if (await fileExists(path.join(projectRoot, "Makefile"))) {
    return "make";
  }
  if (await fileExists(path.join(projectRoot, "CMakeLists.txt"))) {
    return "cmake";
  }
  if (await fileExists(path.join(projectRoot, "Cargo.toml"))) {
    return "cargo";
  }
  if (await fileExists(path.join(projectRoot, "pyproject.toml"))) {
    return "poetry";
  }
  if (await fileExists(path.join(projectRoot, "setup.py"))) {
    return "setuptools";
  }
  // Detect package manager from lockfile
  if (await fileExists(path.join(projectRoot, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (await fileExists(path.join(projectRoot, "yarn.lock"))) {
    return "yarn";
  }
  if (await fileExists(path.join(projectRoot, "package-lock.json"))) {
    return "npm";
  }
  return undefined;
}

/**
 * Auto-detect project information from the filesystem.
 * Returns sensible defaults even when no package.json is present.
 */
async function detectProjectInfo(projectRoot: string): Promise<DetectedProjectInfo> {
  const pkgJsonPath = path.join(projectRoot, "package.json");
  const pkg = await readJsonFile(pkgJsonPath);
  const pkgName = typeof pkg?.name === "string" ? pkg.name : "";
  const pkgDesc = typeof pkg?.description === "string" ? pkg.description : "";

  // Aggregate all deps (prod + dev + peer)
  const allDeps: Record<string, unknown> = {
    ...(pkg?.dependencies as Record<string, unknown>),
    ...(pkg?.devDependencies as Record<string, unknown>),
    ...(pkg?.peerDependencies as Record<string, unknown>),
  };

  const [langsByFile, frameworks, testFramework, lintingTools, buildSystem] = await Promise.all([
    detectLanguagesFromFiles(projectRoot),
    detectFrameworks(projectRoot, allDeps),
    detectTestFramework(projectRoot, allDeps),
    detectLintingTools(projectRoot, allDeps),
    detectBuildSystem(projectRoot, allDeps),
  ]);

  // Prefer tsconfig presence to confirm TypeScript
  const hasTs = await fileExists(path.join(projectRoot, "tsconfig.json"));
  const languages = hasTs
    ? ["typescript", ...langsByFile.filter((l) => l !== "typescript")]
    : langsByFile;

  return {
    projectName: pkgName || path.basename(projectRoot),
    description: pkgDesc,
    languages: [...new Set(languages)].slice(0, 6),
    frameworks,
    buildSystem,
    testFramework,
    lintingTools,
  };
}

// ---------------------------------------------------------------------------
// LLM provider helpers
// ---------------------------------------------------------------------------

type ProviderChoice =
  | "builderforcellm"
  | "anthropic"
  | "openai"
  | "openrouter"
  | "gemini"
  | "ollama"
  | "vllm"
  | "workforce"
  | "skip";

interface ProviderMeta {
  id: ProviderChoice;
  label: string;
  envVar?: string;
  defaultModel: string;
}

const PROVIDERS: ProviderMeta[] = [
  {
    id: "builderforcellm",
    label: "BuilderForceAgentsLLM (recommended) — Builderforce.AI",
    defaultModel: "builderforcellm/auto",
  },
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    envVar: "ANTHROPIC_API_KEY",
    defaultModel: "anthropic/claude-sonnet-4-6",
  },
  {
    id: "openai",
    label: "OpenAI (GPT-4o)",
    envVar: "OPENAI_API_KEY",
    defaultModel: "openai/gpt-4o",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    envVar: "OPENROUTER_API_KEY",
    defaultModel: "openrouter/auto",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    envVar: "GEMINI_API_KEY",
    defaultModel: "google/gemini-2.0-flash",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    envVar: "OLLAMA_API_KEY",
    defaultModel: "ollama/llama3.3",
  },
  {
    id: "vllm",
    label: "vLLM / llama.cpp / LiteLLM (local)",
    defaultModel: "vllm/your-model-id",
  },
  {
    id: "workforce",
    label: "Builderforce Workforce Agent (custom trained LLM)",
    defaultModel: "builderforcellm/auto",
  },
];

function isProviderConfigured(p: ProviderMeta): boolean {
  if (!p.envVar) {
    return false;
  }
  const val = process.env[p.envVar];
  return typeof val === "string" && val.trim().length > 0;
}

async function applyLlmProviderModel(
  projectRoot: string,
  provider: string,
  modelRef: string,
): Promise<void> {
  try {
    await updateProjectContextFields(projectRoot, { llm: { provider, model: modelRef } });
  } catch {
    // non-fatal: context write failures shouldn't break init
  }
}

/**
 * Wizard sub-step: prompt for and install a Builderforce Workforce agent.
 * Extracted from `promptLlmProvider` for clarity.
 */
async function promptWorkforceAgentProvider(projectRoot: string): Promise<string | null> {
  const registryUrl = await text({
    message: "Builderforce registry URL:",
    initialValue: DEFAULT_REGISTRY_URL,
  });
  if (typeof registryUrl === "symbol") {
    return null;
  }

  const agentIdInput = await text({
    message: "Workforce agent ID (from the Builderforce registry):",
    placeholder: "e.g. 550e8400-e29b-41d4-a716-446655440000",
  });
  if (typeof agentIdInput === "symbol" || !agentIdInput.trim()) {
    return null;
  }

  const agentId = agentIdInput.trim();
  try {
    return await installWorkforceAgent({
      agentId,
      projectRoot,
      registryUrl: normalizeBaseUrl(registryUrl.trim()) || DEFAULT_REGISTRY_URL,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    note(
      [msg, "", "You can retry later with: builderforce agent install <agentId>"].join("\n"),
      "Failed to install Workforce agent",
    );
    return null;
  }
}

/**
 * Interactive wizard step: choose and configure an LLM provider.
 * Returns summary string of what was done (for the outro), or null if skipped.
 */
async function promptLlmProvider(projectRoot: string): Promise<string | null> {
  const options = [
    ...PROVIDERS.map((p) => ({
      value: p.id,
      label: isProviderConfigured(p) ? `${p.label}  ✓ configured` : p.label,
      hint:
        p.id === "builderforcellm"
          ? "managed proxy (no local API key needed)"
          : isProviderConfigured(p)
            ? `${p.envVar} is set`
            : p.envVar
              ? `needs ${p.envVar}`
              : "enter server URL",
    })),
    { value: "skip" as ProviderChoice, label: "Skip — configure later" },
  ];

  const chosen = await select<ProviderChoice>({
    message: "LLM provider to use for AI agents:",
    options,
  });

  if (typeof chosen === "symbol" || chosen === "skip") {
    return null;
  }

  // ── Builderforce Workforce Agent (custom trained LLM) ─────────────────────
  if (chosen === "workforce") {
    return promptWorkforceAgentProvider(projectRoot);
  }

  const meta = PROVIDERS.find((p) => p.id === chosen)!;

  // ── Cloud providers: API key ──────────────────────────────────────────────
  if (
    chosen === "builderforcellm" ||
    chosen === "anthropic" ||
    chosen === "openai" ||
    chosen === "openrouter" ||
    chosen === "gemini"
  ) {
    if (chosen === "builderforcellm") {
      // BuilderForceAgentsLLM routes through Builderforce's managed proxy, so it
      // requires a Link API key. If the user doesn't have one yet, offer
      // inline registration (mirrors the gateway onboarding wizard flow).
      const existingKey = readSharedEnvVar("BUILDERFORCE_API_KEY")?.trim();
      if (!existingKey) {
        const { promptBuilderforceOnboarding } = await import("./builderforce-onboarding.js");
        const defaultInstanceName = path.basename(projectRoot) || "builderforce";
        await promptBuilderforceOnboarding({
          projectRoot,
          defaultInstanceName,
          forcePrompt: true,
        });

        // Re-check after the registration wizard — user may have skipped.
        const keyAfter = readSharedEnvVar("BUILDERFORCE_API_KEY")?.trim();
        if (!keyAfter) {
          note(
            [
              "BuilderForceAgentsLLM requires a Builderforce account to work.",
              "You can connect later with: builderforce init --reconnect",
              "Or switch to a different provider with: builderforce init",
            ].join("\n"),
            "Skipped — BuilderForceAgentsLLM won't be available yet",
          );
        }
      }
      await applyLlmProviderModel(projectRoot, chosen, meta.defaultModel);
      return `${meta.label} configured, model → ${meta.defaultModel}`;
    }

    if (isProviderConfigured(meta)) {
      note(`${meta.envVar} is already set — keeping existing credential.`, meta.label);
      await applyLlmProviderModel(projectRoot, chosen, meta.defaultModel);
      return `${meta.label} (existing credential kept), model → ${meta.defaultModel}`;
    }

    const apiKey = await password({
      message: `${meta.label} API key:`,
    });

    if (typeof apiKey === "symbol" || !apiKey.trim()) {
      return null;
    }

    const keyValue = apiKey.trim();

    if (chosen === "anthropic") {
      await setAnthropicApiKey(keyValue);
    } else if (chosen === "openrouter") {
      await setOpenrouterApiKey(keyValue);
    } else if (chosen === "gemini") {
      await setGeminiApiKey(keyValue);
    } else {
      // openai — write to ~/.builderforce/.env as OPENAI_API_KEY
      upsertSharedEnvVar({ key: "OPENAI_API_KEY", value: keyValue });
    }

    await applyLlmProviderModel(projectRoot, chosen, meta.defaultModel);
    return `${meta.label} configured, model → ${meta.defaultModel}`;
  }

  // ── Ollama (local) ────────────────────────────────────────────────────────
  if (chosen === "ollama") {
    const ollamaUrl = await text({
      message: "Ollama base URL:",
      initialValue: "http://127.0.0.1:11434",
    });
    if (typeof ollamaUrl === "symbol") {
      return null;
    }

    const ollamaModel = await text({
      message: "Ollama model to use as default:",
      initialValue: "llama3.3",
      placeholder: "llama3.3  or  qwen2.5-coder:32b  or  deepseek-r1:32b",
    });
    if (typeof ollamaModel === "symbol") {
      return null;
    }

    const modelId = ollamaModel.trim() || "llama3.3";
    const modelRef = `ollama/${modelId}`;

    // Enable Ollama: any non-empty value works
    upsertSharedEnvVar({ key: "OLLAMA_API_KEY", value: "ollama-local" });

    // Write provider config if using a non-default URL, then set default model
    const normalizedUrl = normalizeBaseUrl(ollamaUrl.trim());
    if (normalizedUrl !== "http://127.0.0.1:11434") {
      try {
        const snapshot = await readConfigFileSnapshot();
        const existing = snapshot?.config ?? {};
        await writeConfigFile({
          ...existing,
          models: {
            ...existing.models,
            providers: {
              ...existing.models?.providers,
              ollama: {
                baseUrl: normalizedUrl,
                api: "ollama" as const,
                apiKey: "ollama-local",
                models: [],
              },
            },
          },
        });
      } catch {
        // best-effort
      }
    }
    await applyLlmProviderModel(projectRoot, "ollama", modelRef);
    return `Ollama configured (${normalizedUrl}), model → ${modelRef}`;
  }

  // ── vLLM / llama.cpp / LiteLLM (local) ───────────────────────────────────
  if (chosen === "vllm") {
    const vllmUrl = await text({
      message: "Server base URL (e.g. http://127.0.0.1:8000/v1):",
      initialValue: "http://127.0.0.1:8000/v1",
    });
    if (typeof vllmUrl === "symbol") {
      return null;
    }

    const vllmModelId = await text({
      message: "Model ID served at that endpoint:",
      placeholder: "meta-llama/Llama-3.1-8B-Instruct",
    });
    if (typeof vllmModelId === "symbol") {
      return null;
    }
    if (!vllmModelId.trim()) {
      return null;
    }

    const modelId = vllmModelId.trim();
    const providerRef = "vllm";
    const modelRef = `${providerRef}/${modelId}`;

    try {
      const snapshot = await readConfigFileSnapshot();
      const existing = snapshot?.config ?? {};
      await writeConfigFile({
        ...existing,
        models: {
          ...existing.models,
          providers: {
            ...existing.models?.providers,
            vllm: {
              baseUrl: normalizeBaseUrl(vllmUrl.trim()),
              api: "openai-completions" as const,
              apiKey: "VLLM_API_KEY",
              models: [
                {
                  id: modelId,
                  name: modelId,
                  reasoning: false,
                  input: ["text"],
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  contextWindow: 128000,
                  maxTokens: 8192,
                },
              ],
            },
          },
        },
      });
    } catch {
      // best-effort
    }
    await applyLlmProviderModel(projectRoot, "vllm", modelRef);
    return `vLLM configured (${vllmUrl.trim()}), model → ${modelRef}`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Builderforce connection wizard
// ---------------------------------------------------------------------------

/** Thin fetch wrapper — throws a descriptive error on non-2xx. */
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

async function ensureProjectMappingFromStoredCreds(params: {
  projectRoot: string;
  projectName: string;
  description?: string;
}): Promise<void> {
  const serverUrl = readSharedEnvVar("BUILDERFORCE_URL") ?? "https://api.builderforce.ai";
  const webToken = readSharedEnvVar("BUILDERFORCE_WEB_TOKEN");
  const tenantIdRaw = readSharedEnvVar("BUILDERFORCE_TENANT_ID");
  if (!webToken || !tenantIdRaw) {
    return;
  }

  const tenantId = Number(tenantIdRaw);
  if (!Number.isFinite(tenantId) || tenantId <= 0) {
    return;
  }

  const ctx = await loadProjectContext(params.projectRoot).catch(() => null);
  const agentNodeId = ctx?.builderforce?.instanceId?.trim();
  if (!agentNodeId) {
    return;
  }

  const tenantJwtRes = await builderforceApiFetch<{ token: string }>(
    `${serverUrl}/api/auth/tenant-token`,
    {
      method: "POST",
      token: webToken,
      body: JSON.stringify({ tenantId }),
    },
  ).catch(() => null);
  if (!tenantJwtRes?.token) {
    return;
  }

  const mapped = await ensureProjectMapping({
    serverUrl,
    tenantJwt: tenantJwtRes.token,
    projectRoot: params.projectRoot,
    projectName: params.projectName,
    description: params.description,
    agentNodeId,
  });

  if (mapped) {
    await updateProjectContextFields(params.projectRoot, {
      builderforce: {
        instanceId: agentNodeId,
        ...ctx?.builderforce,
        projectId: mapped.projectId,
      },
    }).catch(() => undefined);
  }
}

/**
 * Full API-driven Builderforce onboarding wizard.
 *
 * Flow:
 *   1. Offer to skip
 *   2. Server URL
 *   3. Login or create account → webToken
 *   4. Pick or create tenant   → tenantId + tenantJwt
 *   5. Register new agentNode       → agentNode.id, agentNode.slug, one-time apiKey
 *   6. Persist everything globally + to project context.yaml
 */
async function promptBuilderforceSetup(
  projectRoot: string,
  defaultInstanceName: string,
): Promise<string | null> {
  // ── Already connected? Check global ~/.builderforce/.env first ──────────────
  const existingKey = readSharedEnvVar("BUILDERFORCE_API_KEY");
  if (existingKey) {
    const existingUrl = readSharedEnvVar("BUILDERFORCE_URL") ?? "https://api.builderforce.ai";
    const existingTenantId = readSharedEnvVar("BUILDERFORCE_TENANT_ID");
    // Also check project context for the agentNode slug
    const existingCtx = await loadProjectContext(projectRoot).catch(() => null);
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
        ``,
        `Run 'builderforce init --reconnect' to link a different account.`,
      ].join("\n"),
      "Already connected to Builderforce",
    );
    return `Builderforce: already connected (${existingUrl})`;
  }

  // ── Previously declined? Skip silently ───────────────────────────────────
  const skipped = readSharedEnvVar("BUILDERFORCE_SKIPPED");
  if (skipped === "1") {
    return null;
  }

  const connect = await confirm({
    message:
      "Connect to Builderforce? (optional — manage projects, tasks & agents across your mesh)",
    initialValue: true,
  });
  if (typeof connect === "symbol" || !connect) {
    // Remember the choice so we never ask again during init.
    // The user can connect later: builderforce init --reconnect
    upsertSharedEnvVar({ key: "BUILDERFORCE_SKIPPED", value: "1" });
    note("You can connect to Builderforce anytime with: builderforce init --reconnect", "Skipped");
    return null;
  }

  // ── 1. Server URL ─────────────────────────────────────────────────────────
  const urlInput = await text({
    message: "Orchestration API URL (Builderforce):",
    initialValue: "https://api.builderforce.ai",
  });
  if (typeof urlInput === "symbol") {
    return null;
  }
  const serverUrl = normalizeBaseUrl(urlInput.trim()) || "https://api.builderforce.ai";

  // ── 2. Login or register ──────────────────────────────────────────────────
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

  // ── 3. Authenticate ───────────────────────────────────────────────────────
  let webToken = "";
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
      webToken = res.token;
      authSpin.stop("Account created");
    } else {
      authSpin.start("Authenticating…");
      const res = await builderforceApiFetch<{ token: string }>(`${serverUrl}/api/auth/web/login`, {
        method: "POST",
        body: JSON.stringify({ email, password: pwd }),
      });
      webToken = res.token;
      authSpin.stop("Authenticated");
    }
  } catch (err) {
    authSpin.stop("Authentication failed");
    note(String(err instanceof Error ? err.message : err), "Error");
    return null;
  }

  // ── 4. Pick or create tenant ──────────────────────────────────────────────
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
    // No tenants yet — create one
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
        `${serverUrl}/api/tenants/create`,
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

  // ── 5. Get tenant-scoped JWT ──────────────────────────────────────────────
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

  // ── 6. Register agentNode instance ─────────────────────────────────────────────
  const agentNodeNameInput = await text({
    message: "AgentNode instance name (shown in dashboard):",
    initialValue: defaultInstanceName,
  });
  if (typeof agentNodeNameInput === "symbol") {
    return null;
  }
  const agentNodeName = agentNodeNameInput.trim() || defaultInstanceName;

  const agentNodeSpin = spinner();
  agentNodeSpin.start("Registering agentNode instance…");
  let agentNodeId = "";
  let agentNodeSlug = "";
  let apiKey = "";
  let projectId = "";
  let projectAction: "created" | "updated" | "unknown" = "unknown";
  try {
    const res = await builderforceApiFetch<{
      agentNode: { id: number; name: string; slug: string };
      apiKey: string;
    }>(`${serverUrl}/api/agentNodes`, {
      method: "POST",
      token: tenantJwt,
      body: JSON.stringify({ name: agentNodeName }),
    });
    agentNodeId = String(res.agentNode.id);
    agentNodeSlug = res.agentNode.slug;
    apiKey = res.apiKey;

    const mapped = await ensureProjectMapping({
      serverUrl,
      tenantJwt,
      agentNodeId,
      projectRoot,
      projectName: defaultInstanceName,
      description: `builderForceAgents project at ${projectRoot}`,
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

  // ── 7. Persist globally + locally ────────────────────────────────────────
  upsertSharedEnvVar({ key: "BUILDERFORCE_URL", value: serverUrl });
  upsertSharedEnvVar({ key: "BUILDERFORCE_WEB_TOKEN", value: webToken });
  upsertSharedEnvVar({ key: "BUILDERFORCE_TENANT_ID", value: String(tenantId) });
  upsertSharedEnvVar({ key: "BUILDERFORCE_API_KEY", value: apiKey });

  try {
    await updateProjectContextFields(projectRoot, {
      builderforce: {
        instanceId: agentNodeId,
        instanceSlug: agentNodeSlug,
        instanceName: agentNodeName,
        ...(projectId ? { projectId } : {}),
        tenantId,
        url: serverUrl,
      },
    });
  } catch {
    // best-effort
  }

  note(
    [
      `AgentNode API key saved to ~/.builderforce/.env`,
      `This key was shown once — it is hashed on the server.`,
      `Instance slug: ${agentNodeSlug}  ·  tenant: ${tenantId}`,
      projectId ? `Project ${projectAction}: ${projectId}` : `Project mapping: not available`,
    ].join("\n"),
    "Builderforce connected",
  );

  return `Builderforce: ${agentNodeName} (${agentNodeSlug}) on tenant ${tenantId}`;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export function createBuilderForceAgentsCommand(): Command {
  const cmd = new Command("project");

  cmd.description("Manage builderForceAgents project context").addCommand(createStatusCommand());

  return cmd;
}

export function createInitCommand(): Command {
  return new Command("init")
    .description("Initialize a project with builderForceAgents")
    .argument("[path]", "Project directory path", ".")
    .action(async (projectPath: string) => {
      const projectRoot = projectPath === "." ? process.cwd() : projectPath;

      // If already initialized, jump straight into the persistent session
      const isInitialized = await isBuilderForceAgentsProject(projectRoot);
      if (isInitialized) {
        await runBuilderForceAgentsSession(projectRoot);
        return;
      }

      intro(theme.accent("builderForceAgents"));

      // Auto-detect project info
      const detectSpin = spinner();
      detectSpin.start("Detecting project info...");
      const detected = await detectProjectInfo(projectRoot);
      detectSpin.stop("Project info detected");

      // Show what was found, let user confirm or override each field
      note(
        [
          `name:        ${detected.projectName}`,
          `languages:   ${detected.languages.join(", ") || "(none detected)"}`,
          `frameworks:  ${detected.frameworks.join(", ") || "(none detected)"}`,
          `build:       ${detected.buildSystem ?? "(unknown)"}`,
          `test:        ${detected.testFramework ?? "(unknown)"}`,
          `lint:        ${detected.lintingTools.join(", ") || "(none detected)"}`,
        ].join("\n"),
        "Auto-detected",
      );

      // Project name
      const projectNameInput = await text({
        message: "Project name:",
        initialValue: detected.projectName,
      });
      if (typeof projectNameInput === "symbol") {
        outro(theme.muted("Cancelled"));
        return;
      }

      // Description
      const descriptionInput = await text({
        message: "Project description:",
        initialValue: detected.description,
        placeholder: "A brief description of what this project does",
      });
      if (typeof descriptionInput === "symbol") {
        outro(theme.muted("Cancelled"));
        return;
      }

      // Languages – pre-filled, user can edit
      const languagesInput = await text({
        message: "Primary languages (comma-separated):",
        initialValue: detected.languages.join(", "),
        placeholder: "typescript, javascript",
      });
      if (typeof languagesInput === "symbol") {
        outro(theme.muted("Cancelled"));
        return;
      }

      // Frameworks – pre-filled, user can edit
      const frameworksInput = await text({
        message: "Frameworks used (comma-separated):",
        initialValue: detected.frameworks.join(", "),
        placeholder: "express, react",
      });
      if (typeof frameworksInput === "symbol") {
        outro(theme.muted("Cancelled"));
        return;
      }

      // Initialize project
      const spin = spinner();
      spin.start("Setting up .builderforce/...");

      try {
        await initializeBuilderForceAgentsProject(projectRoot, {
          projectName: projectNameInput || detected.projectName,
          description: descriptionInput || detected.description,
          languages:
            languagesInput.trim().length > 0
              ? languagesInput
                  .split(",")
                  .map((l) => l.trim())
                  .filter(Boolean)
              : detected.languages,
          frameworks:
            frameworksInput.trim().length > 0
              ? frameworksInput
                  .split(",")
                  .map((f) => f.trim())
                  .filter(Boolean)
              : detected.frameworks,
          buildSystem: detected.buildSystem,
          testFramework: detected.testFramework,
          lintingTools: detected.lintingTools,
        });

        spin.stop(theme.success("builderForceAgents initialized!"));

        note(
          [
            `  ${theme.muted("context.yaml")}      – project metadata (edit to tune AI understanding)`,
            `  ${theme.muted("architecture.md")} – high-level design docs`,
            `  ${theme.muted("rules.yaml")}       – coding standards & conventions`,
          ].join("\n"),
          `.builderforce/ created`,
        );

        // LLM provider setup
        await promptLlmProvider(projectRoot);

        // Builderforce connection
        await promptBuilderforceSetup(projectRoot, projectNameInput || detected.projectName);
        await ensureProjectMappingFromStoredCreds({
          projectRoot,
          projectName: projectNameInput || detected.projectName,
          description: descriptionInput || detected.description,
        });

        const aiPopulate = await confirm({
          message: "Use an AI agent to populate context.yaml, architecture.md, and rules.yaml now?",
          initialValue: true,
        });

        // Drop into the persistent session instead of exiting
        const populateMessage =
          typeof aiPopulate !== "symbol" && aiPopulate
            ? "Analyze this project and populate .builderforce/context.yaml, architecture.md, and rules.yaml with accurate project context"
            : undefined;

        await runBuilderForceAgentsSession(projectRoot, { message: populateMessage });
      } catch (error) {
        spin.stop(theme.error("Failed to initialize project"));
        outro(theme.error(error instanceof Error ? error.message : String(error)));
      }
    });
}

function createStatusCommand(): Command {
  return new Command("status")
    .description("Show builderForceAgents project status and context")
    .argument("[path]", "Project directory path", ".")
    .action(async (projectPath: string) => {
      const projectRoot = projectPath === "." ? process.cwd() : projectPath;

      const isInitialized = await isBuilderForceAgentsProject(projectRoot);

      if (!isInitialized) {
        console.log(theme.warn("Project is not initialized with builderForceAgents"));
        console.log(theme.muted(`Run 'builderforce init' to initialize`));
        return;
      }

      console.log(theme.success("✓ builderForceAgents project detected"));
      console.log(theme.muted(`  Location: ${projectRoot}/.builderforce/`));
    });
}

// ---------------------------------------------------------------------------
// builderforce agent — Workforce agent management
// ---------------------------------------------------------------------------

/**
 * `builderforce agent` sub-command group.
 *
 * Subcommands:
 *   builderforce agent install <agentId>   — download and activate a Workforce agent
 *   builderforce agent info                — show the currently installed agent
 *   builderforce agent remove              — uninstall the Workforce agent
 */
export function createAgentCommand(): Command {
  const cmd = new Command("workforce").description(
    "Manage Builderforce Workforce agents (custom trained LLMs)",
  );

  cmd.addCommand(
    new Command("install")
      .description("Install a Workforce agent from the Builderforce registry")
      .argument("<agentId>", "Agent UUID or name from the Workforce Registry")
      .option("--registry <url>", "Builderforce registry URL", DEFAULT_REGISTRY_URL)
      .option("--path <dir>", "Project directory", ".")
      .action(async (agentId: string, opts: { registry: string; path: string }) => {
        const projectRoot = opts.path === "." ? process.cwd() : opts.path;
        intro(theme.accent("builderForceAgents") + " " + theme.muted("agent install"));
        try {
          const summary = await installWorkforceAgent({
            agentId,
            projectRoot,
            registryUrl: opts.registry,
          });
          outro(theme.success("Agent installed!\n\n" + summary));
        } catch (err) {
          outro(theme.error(err instanceof Error ? err.message : String(err)));
          process.exitCode = 1;
        }
      }),
  );

  cmd.addCommand(
    new Command("info")
      .description("Show the currently installed Workforce agent")
      .option("--path <dir>", "Project directory", ".")
      .action(async (opts: { path: string }) => {
        const projectRoot = opts.path === "." ? process.cwd() : opts.path;
        await showWorkforceAgentInfo(projectRoot);
      }),
  );

  cmd.addCommand(
    new Command("remove")
      .description("Remove the installed Workforce agent and revert to default LLM")
      .option("--path <dir>", "Project directory", ".")
      .action(async (opts: { path: string }) => {
        const projectRoot = opts.path === "." ? process.cwd() : opts.path;
        await removeWorkforceAgent(projectRoot);
      }),
  );

  return cmd;
}
