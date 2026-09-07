import path from "node:path";
import { pathToFileURL } from "node:url";
import type { BuilderForceAgentsPluginApi } from "../plugins/types.js";
import { shouldIncludeHook } from "./config.js";
import type { InternalHookHandler } from "./internal-hooks.js";
import type { HookEntry } from "./types.js";
import { loadHookEntriesFromDir } from "./workspace.js";

export type PluginHookLoadResult = {
  hooks: HookEntry[];
  loaded: number;
  skipped: number;
  errors: string[];
};

function resolveHookDir(api: BuilderForceAgentsPluginApi, dir: string): string {
  if (path.isAbsolute(dir)) {
    return dir;
  }
  return path.resolve(path.dirname(api.source), dir);
}

function normalizePluginHookEntry(api: BuilderForceAgentsPluginApi, entry: HookEntry): HookEntry {
  return {
    ...entry,
    hook: {
      ...entry.hook,
      source: "builderforce-plugin",
      pluginId: api.id,
    },
    metadata: {
      ...entry.metadata,
      hookKey: entry.metadata?.hookKey ?? `${api.id}:${entry.hook.name}`,
      events: entry.metadata?.events ?? [],
    },
  };
}

async function loadHookHandler(
  entry: HookEntry,
  api: BuilderForceAgentsPluginApi,
): Promise<InternalHookHandler | null> {
  try {
    const url = pathToFileURL(entry.hook.handlerPath).href;
    const cacheBustedUrl = `${url}?t=${Date.now()}`;
    const mod = (await import(cacheBustedUrl)) as Record<string, unknown>;
    const exportName = entry.metadata?.export ?? "default";
    const handler = mod[exportName];
    if (typeof handler === "function") {
      return handler as InternalHookHandler;
    }
    api.logger.warn?.(`[hooks] ${entry.hook.name} handler is not a function`);
    return null;
  } catch (err) {
    api.logger.warn?.(`[hooks] Failed to load ${entry.hook.name}: ${String(err)}`);
    return null;
  }
}

/**
 * Discover HOOK.md hook packages in a plugin-declared directory and register
 * them through the plugin API so they run at the same internal-hook points as
 * bundled/workspace hooks.
 *
 * Registration is synchronous (the plugin loader is synchronous): every
 * eligible hook is attached to the internal-hook runner before this function
 * yields. Handler modules are imported lazily, so a hook is live on the plugin
 * record immediately and the returned promise only reports load outcomes.
 * A handler that fails to import stays registered as a no-op and is surfaced
 * via `errors`.
 */
export function registerPluginHooksFromDir(
  api: BuilderForceAgentsPluginApi,
  dir: string,
): Promise<PluginHookLoadResult> {
  const resolvedDir = resolveHookDir(api, dir);
  const hooks = loadHookEntriesFromDir({
    dir: resolvedDir,
    source: "builderforce-plugin",
    pluginId: api.id,
  });

  const result: PluginHookLoadResult = {
    hooks,
    loaded: 0,
    skipped: 0,
    errors: [],
  };
  const pending: Promise<void>[] = [];

  for (const entry of hooks) {
    const normalizedEntry = normalizePluginHookEntry(api, entry);
    const events = normalizedEntry.metadata?.events ?? [];
    if (events.length === 0) {
      api.logger.warn?.(`[hooks] ${entry.hook.name} has no events; skipping`);
      api.registerHook(events, async () => undefined, {
        entry: normalizedEntry,
        register: false,
      });
      result.skipped += 1;
      continue;
    }

    const eligible = shouldIncludeHook({ entry: normalizedEntry, config: api.config });
    if (!eligible) {
      api.registerHook(events, async () => undefined, {
        entry: normalizedEntry,
        register: false,
      });
      result.skipped += 1;
      continue;
    }

    const handlerPromise = loadHookHandler(entry, api);
    api.registerHook(
      events,
      async (event) => {
        const handler = await handlerPromise;
        if (handler) {
          await handler(event);
        }
      },
      { entry: normalizedEntry, register: true },
    );
    pending.push(
      handlerPromise.then((handler) => {
        if (handler) {
          result.loaded += 1;
        } else {
          result.errors.push(`[hooks] Failed to load ${entry.hook.name}`);
          result.skipped += 1;
        }
      }),
    );
  }

  return Promise.all(pending).then(() => result);
}
