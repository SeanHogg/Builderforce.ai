import type { PluginRuntime } from '@seanhogg/builderforce-agents/plugin-sdk';

let runtime: PluginRuntime | null = null;

export function setJiraLinearRuntime(next: PluginRuntime): void {
  runtime = next;
}

export function getJiraLinearRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error('JiraLinear runtime not initialized');
  }
  return runtime;
}