/**
 * Step Validation Plugin Service
 *
 * Exposes a validator service through plugin hooks.
 *
 * Supported hook names:
 * - pre_input_validation: called before input passes to a step.
 * - post_output_validation: called after a step completes.
 *
 * Handler signature:
 *   (event?: { step_id?: string; step_name?: string | null; enforcement_mode?: EnforcementMode; pending_payload?: unknown }) => Promise<ValidationResult | void>
 *
 * Example usage:
 *   api.registerPluginService(stepValidationService(api))
 */
'use strict';

import type {
  BuilderForceAgentsPluginApi,
  PluginLogger,
  PluginHookHandlerMap,
} from '../../src/plugins/types.js';
import { type EnforcementMode, type FailedRule, type ValidationResult } from './types.js';
import { validatePayload, resetSchemaCache } from './validator.js';

/** Cached plugin context (singleton). */
let ctx: {
  config: unknown;
  source: string;
  logger: Required<PluginLogger> | undefined;
} | null = null;

/** Validation options per step. */
export interface ValidationOptions {
  enforcementMode: EnforcementMode;
  contracts: {
    input?: string | Record<string, unknown>;
    output?: string | Record<string, unknown>;
  };
}

/** Temporary steps registry (keyed by step_id). */
const steps = new Map<string, ValidationOptions>();

/**
 * Create the step-validation plugin service.
 * * Registers hooks: pre_input_validation, post_output_validation, after_hook.
 * * Exposes __wrap_with_validation(value, options) for a single-step adapter.
 * * Provides resetSchemaCache if the user wants to clear invalid schemas.
 * * Uses the plugin’s logger if present.
 */
export function stepValidationService(api: BuilderForceAgentsPluginApi) {
  const PLUGIN_ID = 'step-validation';

  /** Validate input before step execution. */
  const preInputValidation: PluginHookHandlerMap['pre_input_validation'] = async (event = {}) => {
    if (!event.step_id || !steps.has(event.step_id)) {
      api.logger?.debug?.('[step-validation] pre_input_validation: step_id missing or unregistered');
      return;
    }

    const stepId = event.step_id;
    const options = steps.get(stepId)!;
    if (!options.contracts.input || options.enforcementMode === 'disabled') {
      api.logger?.debug?.(`[step-validation] skipping pre_input_validation for ${stepId}`);
      return;
    }

    const result = validatePayload(
      event.pending_payload ?? null,
      options.contracts.input,
      'input',
      source,
    );

    if (!result.valid) {
      api.logger?.warn?.(
        `[step-validation] pre_input_validation failed for ${stepId}`,
        result.errors,
      );
    }
    return result;
  };

  /** Validate output after step execution. */
  const postOutputValidation: PluginHookHandlerMap['post_output_validation'] = async (event = {}) => {
    if (!event.step_id || !steps.has(event.step_id)) {
      api.logger?.debug?.('[step-validation] post_output_validation: step_id missing or unregistered');
      return;
    }

    const stepId = event.step_id;
    const options = steps.get(stepId)!;
    if (!options.contracts.output || options.enforcementMode === 'disabled') {
      api.logger?.debug?.(`[step-validation] skipping post_output_validation for ${stepId}`);
      return;
    }

    const result = validatePayload(
      event.step_result ?? null,
      options.contracts.output,
      'output',
      source,
    );

    if (!result.valid) {
      api.logger?.warn?.(
        `[step-validation] post_output_validation failed for ${stepId}`,
        result.errors,
      );
    }
    return result;
  };

  /** Post-hook for generic references. */
  const afterHook: PluginHookHandlerMap['after_hook'] = async (event = {}) => {
    api.logger?.debug?.(`[step-validation] after_hook: ${event?.step_id || 'unknown'}`);
  };

  const service = {
    id: PLUGIN_ID,
    start: (_ctx: any) => {
      // Cache context on first start
      if (!ctx) {
        ctx = { config: _ctx.config, source: PLUGIN_ID, logger: _ctx.logger };
      }
    },
    stop: async () => {
      if (ctx) {
        resetSchemaCache(); // Cleanup on stop as requested
      }
    },
  };

  // Register hooks
  api.registerHook('pre_input_validation', preInputValidation, { name: 'step-validation' });
  api.registerHook('post_output_validation', postOutputValidation, { name: 'step-validation' });
  api.registerHook('after_hook', afterHook, { name: 'step-validation' });

  // Export helpers to plugin surface
  return {
    service,
    static: {
      /** Status of the service singleton. */
      getCtx: () => ctx,
      /** Custom validation for a single value by calling validator.ts directly. */
      validateValue: (value: unknown, schema: Record<string, unknown> | string | null, contractType: 'input' | 'output') => {
        return validatePayload(value, schema, contractType, PLUGIN_ID);
      },
      /** Clear the schema cache. Useful for testing or after invalid JSON is loaded. */
      clearSchemaCache: () => {
        schemaCache.clear();
      },
    },
    /** Register a step and its contracts by step_id. */
    registerStep: (stepId: string, options: ValidationOptions) => {
      steps.set(stepId, options);
      api.logger?.debug?.(`[step-validation] registered step ${stepId} (${options.enforcementMode})`);
    },
    /** Remove a step from registration. */
    unregisterStep: (stepId: string) => {
      steps.delete(stepId);
      api.logger?.debug?.(`[step-validation] unregistered step ${stepId}`);
    },
  };
}