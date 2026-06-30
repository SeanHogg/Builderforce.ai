/**
 * The host's local file tools, surfaced to the brain core as BrainActions. Each
 * action's `run()` is a postMessage round-trip to the extension host, which
 * executes the real `fileTools` against the workspace on disk and returns the
 * result string. The model calls them exactly as it would any platform tool — the
 * filesystem boundary is invisible to it.
 */

import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import { request, type ToolSpecMsg } from './vscodeBridge';

export function buildHostTools(specs: ToolSpecMsg[]): BrainAction[] {
  return specs.map((spec) => ({
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    mutates: spec.mutating,
    run: async (args: unknown) => {
      try {
        return await request<string>('tool.call', { name: spec.name, args: args as Record<string, unknown> });
      } catch (e) {
        // Hand the model a structured failure (isFailedToolResult sees `ok:false`).
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  }));
}
