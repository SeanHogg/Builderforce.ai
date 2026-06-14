/**
 * Native model discovery — the pi-free replacement for `@mariozechner/pi-coding-agent`'s
 * `ModelRegistry` + `AuthStorage` (PI cutover, model layer). The on-prem runtime is
 * GATEWAY-routed (locked decision 2): `ModelRegistry` reads the agent's `models.json`
 * (the config-derived `{ providers: { <id>: { baseUrl, api, models } } }`) and `find()`
 * returns those models; anything not in `models.json` resolves via `resolveModel()`'s
 * config fallbacks (inline / forward-compat / providerCfg / synthesized gateway-routed
 * Model) + the gateway. `AuthStorage` is a thin runtime-key holder over `auth.json`
 * (the existing `model-auth.ts` / auth-profiles own real credential resolution).
 *
 * Behavior delta (logged in the Gap Register): pi's BUILT-IN catalog of models the user
 * did not configure (and did not get written into `models.json`) is no longer consulted —
 * configure providers/models, or let the gateway resolve them.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Api, Model } from "../builderforce/model/types.js";

/** A discovered model entry (the subset consumers read). */
export interface ModelEntry {
  id: string;
  provider?: string;
  contextWindow?: number;
  [key: string]: unknown;
}

/** Holds runtime-injected API keys; faithful-enough stand-in for pi's `AuthStorage`. */
export class AuthStorage {
  private runtimeKeys = new Map<string, string>();
  constructor(public readonly storePath?: string) {}
  static create(storePath?: string): AuthStorage {
    return new AuthStorage(storePath);
  }
  setRuntimeApiKey(provider: string, key: string): void {
    this.runtimeKeys.set(provider, key);
  }
  getRuntimeApiKey(provider: string): string | undefined {
    return this.runtimeKeys.get(provider);
  }
}

/**
 * Config/gateway-driven model registry. Intentionally holds no bundled catalog: `find`
 * returns `null` (callers fall back to config-synthesized, gateway-routed models) and
 * `getAll`/`getAvailable` return `[]`.
 */
export class ModelRegistry {
  private readonly models: Model<Api>[] = [];

  constructor(authStorage?: AuthStorage, modelsPath?: string) {
    void authStorage;
    if (modelsPath && existsSync(modelsPath)) {
      try {
        const data = JSON.parse(readFileSync(modelsPath, "utf-8")) as {
          providers?: Record<
            string,
            { baseUrl?: string; api?: string; models?: Array<Record<string, unknown>> }
          >;
        };
        for (const [provider, pc] of Object.entries(data.providers ?? {})) {
          const api = (pc.api ?? "openai-completions") as Api;
          const baseUrl = pc.baseUrl ?? "";
          for (const m of pc.models ?? []) {
            const id = String(m.id ?? "");
            if (!id) continue;
            this.models.push({
              id,
              name: typeof m.name === "string" ? m.name : id,
              api,
              provider,
              baseUrl,
              reasoning: m.reasoning === true,
              input: (Array.isArray(m.input) ? m.input : ["text"]) as ("text" | "image")[],
              cost: (m.cost as Model["cost"]) ?? {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
              },
              contextWindow: typeof m.contextWindow === "number" ? m.contextWindow : 128_000,
              maxTokens: typeof m.maxTokens === "number" ? m.maxTokens : 4096,
            });
          }
        }
      } catch {
        // malformed models.json — leave empty; config fallbacks resolve models.
      }
    }
  }
  find(provider: string, modelId: string): Model<Api> | null {
    return this.models.find((m) => m.provider === provider && m.id === modelId) ?? null;
  }
  getAll(): Model<Api>[] {
    return this.models;
  }
  getAvailable(): Model<Api>[] {
    return this.models;
  }
  async getApiKey(model: { provider: string }): Promise<string | undefined> {
    void model;
    return undefined;
  }
}

export function discoverAuthStorage(agentDir: string): AuthStorage {
  return AuthStorage.create(path.join(agentDir, "auth.json"));
}

export function discoverModels(authStorage: AuthStorage, agentDir: string): ModelRegistry {
  return new ModelRegistry(authStorage, path.join(agentDir, "models.json"));
}
