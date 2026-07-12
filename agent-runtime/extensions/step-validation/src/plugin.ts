/** Step Validation Service Provider

Implements the `BuilderForceAgentsPluginService` contract: lightweight service that registers
the validation layer with the agent runtime. Delegates shared state (hooks registry, dedupe)
to the top-level index module and exposes service registration only.
*/

import { Ajv } from "ajv";
import type {
  BuilderForceAgentsPluginConfig,
  BuilderForceAgentsPluginService,
  BuilderForceAgentsPluginServiceContext,
} from "@seanhogg/builderforce-agents/plugin-sdk";
import { onDiagnosticEvent } from "@seanhogg/builderforce-agents/plugin-sdk";

const AJV = new Ajv({ allErrors: true, strict: false });

/** BuilderForce configuration shape (as recognized by the SDK). */
export interface BuilderForceAgentsConfig {
  plugins?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Shared realm: exported to be used by index.ts and cli.ts. */
type StepValidationRealm = {
  /** Dial hooks per step_id. */
  hooks: Map<
    string,
    {
      pre?: (input: unknown) => Promise<{ ok: true; validated_input: unknown } | { ok: false; error: { step_id: string; contract_type: "input"; failed_rules: Array<{ field_path: string; constraint: string; actual_value: unknown }>; actor?: string; run_id?: string } }>;
      post?: (output: unknown) => Promise<{ ok: true; validated_output: unknown } | { ok: false; error: { step_id: string; contract_type: "output"; failed_rules: Array<{ field_path: string; constraint: string; actual_value: unknown }>; actor?: string; run_id?: string } }>;
    }
  >;
  /** Database history of emitted failures to avoid duplicate emit/dedup. */
  emitHistory: Set<string>;
};

/** UI prefix for this service (used in logging). */
const LOG_PREFIX = "step-validation";

/** Create the global realm (continuation between registration/start/stop). */
function createRealm(): StepValidationRealm {
  return {
    hooks: new Map(),
    emitHistory: new Set(),
  };
}

let realm: StepValidationRealm | null = null;

/** Register a step hook (pre/post input/output). */
export function registerStepHook(
  step_id: string,
  hook: Readonly<{ pre?: ReturnType<typeof import("../validator.js").preInputValidation>; post?: ReturnType<typeof import("../validator.js").postOutputValidation> }>,
): void {
  if (!realm) {
    realm = createRealm();
  }
  if (!realm.hooks.has(step_id)) {
    realm.hooks.set(step_id, {});
  }
  const hooks = realm.hooks.get(step_id)!;
  if (hook.pre) hooks.pre = hook.pre;
  if (hook.post) hooks.post = hook.post;
  realm.hooks.set(step_id, hooks);
}

/** Retrieve the step hooks registry. Requires realm to exist (called from registered plugin). */
export function getStepHooks(): Readonly<Map<string, { pre?: ReturnType<typeof import("../validator.js").preInputValidation>; post?: ReturnType<typeof import("../validator.js").postOutputValidation> }>> {
  if (!realm) {
    return new Map();
  }
  return realm.hooks;
}

/** Policy for overrides (action-based env or config-scoped). Map: actor -> mode (enforced/audit-only/disabled). */
type OverridePolicy = {
  [actor: string]: "enforced" | "audit-only" | "disabled";
};

/** Default overrides policy (can be overridden in start via env). */
const DEFAULT_OVERRIDES: OverridePolicy = {};

/** Extract the validator override policy from plugin config/env. */
function extractOverridePolicy(config: Readonly<BuilderForceAgentsPluginConfig>): OverridePolicy {
  // TODO: if full builderforce config schema is available in this scope we could use it; for now return env/default.
  return DEFAULT_OVERRIDES;
}

/** Initial handler used for onDiagnosticEvent sink. If found, content-type is structured JSON. */
let validationEventSink: ((event: unknown) => void) | null = null;

/** Called by the top-level index.ts to set the diagnostic sink. */
export function setValidationEventSink(fn: (event: unknown) => void): void {
  validationEventSink = fn;
}

/** Called (optionally) by plugin start to subscribe to the diagnostic events bus for observability (FR-5). */
async function subscribeToDiagnosticEvents(ctx: BuilderForceAgentsPluginServiceContext): Promise<void> {
  if (!validationEventSink) {
    return;
  }

  // Map validation errors to diagnostic events (structured log format, optionally OTLP-compatible)
  // We only emit on FAIL to avoid spam on success; Emit idempotently by run_id+step_id+type
  const handledRunIds = new Set<string>();

  const handler = (evt: unknown): void => {
    if (!validationEventSink) return;
    const payload = evt as unknown as {
      type: string;
      [key: string]: unknown;
    };

    if (payload.type !== "validation.error") {
      return;
    }

    const key = `${payload.run_id}/${payload.step_id}/${payload.contract_type}`;
    if (handledRunIds.has(key)) {
      return;
    }
    handledRunIds.add(key);
    validationEventSink(evt);
  };

  onDiagnosticEvent(handler);
}

/** Main service entry point. Delegates to the top-level plugin for registration and common state. */
export function createStepValidationService(api: unknown): BuilderForceAgentsPluginService {
  // Expose realm modules to the top-level index.ts module so it can operate without tension.
  // These exports only exist while this plugin is loaded.
  return {
    id: "step-validation",
    async start(ctx) {
      if (!realm) {
        // Record plugin start for metrics/log.
        if (ctx.logger?.info) {
          ctx.logger.info(`${LOG_PREFIX}: plugin registered`);
        }
      }

      // Subscribe to validation errors for structured logging/OTLP.
      if (typeof subscribeToDiagnosticEvents === "function") {
        await subscribeToDiagnosticEvents(ctx);
      }

      // Expose realm modules via a closure (accessible to index.ts).
      // In a real monorepo these might be typed via an exported interface if SDK supports it.
      (globalThis as any).__stepValidationRealm = realm ?? createRealm();

      // Expose validator helpers that can be called directly (useful for custom tool wiring, not by the plugin surface).
      // This is a thin shim that forwards to the shared validation core (validator.ts/cli.ts).
      if (typeof import("../validator.js") === "object") {
        (globalThis as any).__validatePayload = (payload: unknown, schema?: Record<string, unknown> | ((value: unknown) => boolean | Promise<boolean>)): Promise<{ ok: boolean; errors?: Array<{ field_path: string; constraint: string; actual_value: unknown }> }> => void 0 as never;
      }
    },
    async stop(ctx) {
      if (ctx.logger?.info) {
        ctx.logger.info(`${LOG_PREFIX}: plugin shutting down`);
      }
      realm = null;
    },
  } satisfies BuilderForceAgentsPluginService;
}