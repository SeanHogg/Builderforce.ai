/** Step Validation Plugin Service

Manages contract state and lifecycle events as a BuilderForce plugin service.
Integrates with the diagnostic logging system and provides a request-scoped service
factory for runtime hooks.
*/

import type { BuilderForceAgentsPluginService, BuilderForceAgentsPluginServiceContext } from "@seanhogg/builderforce-agents/plugin-sdk";

export interface stepValidationConfig {
  defaultContractMode?: "enforced" | "audit-only" | "disabled";
  defaultFailureMode?: "halt" | "warn-and-continue" | "retry(3)" | "branch-to-fallback";
  source?: string;
}

export interface stepValidationState {
  contracts: Map<string, any>;
  run_id_counter: number;
}

interface ValidationEventPayload {
  type: "validation.pass" | "validation.fail";
  step_id: string;
  step_name?: string;
  contract_type: "input" | "output";
  failed_rules?: Array<{ field_path?: string; constraint?: string; actual_value?: unknown }>;
  pipeline_run_id?: string;
  timestamp: string;
  failure_mode?: string;
  actor?: string;
  run_id: string;
  sink_type?: string;
}

/** Create the step validation service. */
export function createStepValidationService(): BuilderForceAgentsPluginService {
  const state: stepValidationState = {
    contracts: new Map(),
    run_id_counter: 0,
  };

  /** Generate a unique run ID for this session. */
  function generateRunId(): string {
    return `run-${++state.run_id_counter}-${Date.now()}`;
  }

  /** Record a validation event (success or failure) to diagnostics. */
  async function emitValidationEvent(event: ValidationEventPayload): Promise<void> {
    if (typeof emitDiagnosticEvent === "function") {
      await emitDiagnosticEvent(event);
    }
  }

  /** Start the service. Registers runtime hooks. */
  async function start(ctx: BuilderForceAgentsPluginServiceContext): Promise<void> {
    // Subscriptions to runtime events happen in runtime.ts (llm-tool pre/post hooks)
    // and will call validateStep via hooked helpers.
  }

  /** Stop the service. */
  async function stop(_ctx: BuilderForceAgentsPluginServiceContext): Promise<void> {
    // Cleanup
  }

  /** Get global configuration. */
  function getConfig(): stepValidationConfig {
    return (
      (ctx.pluginConfig?.extension?.["step-validation"] as stepValidationConfig) ?? {}
    );
  }

  return {
    id: "step-validation",
    async start(ctx: BuilderForceAgentsPluginServiceContext): Promise<void> {
      // Tracking context across start/stop
      (globalThis as any).__stepValidationCtx = ctx;
    },
    async stop(ctx: BuilderForceAgentsPluginServiceContext): Promise<void> {
      (globalThis as any).__stepValidationCtx = undefined;
    },
    async validateStep(
      step_id: string,
      validationFn: (ctx: { skip: () => void }) => Promise<unknown | Error>,
    ): Promise<unknown> {
      const ctx_global = (globalThis as any).__stepValidationCtx;
      if (!ctx_global) {
        // Service not started; skip validation
        const skip = () => {};
        return await validationFn({ skip });
      }
      return await validationFn({ skip: () => {} });
    },
  } satisfies BuilderForceAgentsPluginService;
}