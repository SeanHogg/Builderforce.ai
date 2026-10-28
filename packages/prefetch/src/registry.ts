/**
 * The action REGISTRY: rows of data the gate classifies against. A host defines its rows
 * once (`defineRegistry`) and the gate offers only the ones that apply here
 * (`offeredActions`): this surface, and the tool each row needs present in the workspace.
 */

import type { GatePorts, PrefetchAction } from './types.js';

/** The label tier 3 scores beside the action ids: "none of these — ask the model". */
export const NEEDS_LLM = 'needs-llm';

/**
 * A registry, validated: unique non-empty ids (never {@link NEEDS_LLM}), a positive
 * budget, and a write action never marked `prefetch` (a prefetch runs without asking).
 * Throws on a malformed row — a registry is code, and a bad row is a bug to fail loudly.
 */
export function defineRegistry(actions: readonly PrefetchAction[]): readonly PrefetchAction[] {
  const seen = new Set<string>();
  for (const a of actions) {
    if (!a.id || a.id === NEEDS_LLM) throw new Error(`prefetch registry: invalid action id "${a.id}"`);
    if (seen.has(a.id)) throw new Error(`prefetch registry: duplicate action id "${a.id}"`);
    seen.add(a.id);
    if (!(a.budgetMs > 0)) throw new Error(`prefetch registry: "${a.id}" needs a positive budgetMs`);
    if (a.kind === 'prefetch' && a.sideEffect === 'write') {
      throw new Error(`prefetch registry: "${a.id}" is a write — a prefetch never asks, so it may only read`);
    }
    if (a.slash !== undefined && !/^\/[\w.-]+$/.test(a.slash)) throw new Error(`prefetch registry: "${a.id}" has a malformed slash "${a.slash}"`);
  }
  return Object.freeze([...actions]);
}

/**
 * The rows this host may run: its surface, and — for a row that needs a tool — the tool
 * reported present (`ports.tools`, memoised per workspace by the host). No tool set ⇒
 * no tool-requiring row is offered: a tool that was never detected is not installed.
 */
export function offeredActions(registry: readonly PrefetchAction[], ports: Pick<GatePorts, 'surface' | 'tools'>): PrefetchAction[] {
  return registry.filter((a) => a.surfaces.includes(ports.surface) && (!a.requires || !!ports.tools?.has(a.requires.tool)));
}
