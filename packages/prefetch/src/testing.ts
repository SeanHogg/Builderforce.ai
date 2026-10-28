/**
 * Test injection for the PreFetch seam: one answer FUNCTION as a one-row registry whose
 * rule matches every request (tier 1), so a test that handed a run "the host's answer
 * to this request" before the registry existed keeps its assertions — the function is
 * asked exactly as before, and its `undefined` falls through to the model.
 */

import { defineRegistry } from './registry.js';
import type { PrefetchPort, PrefetchSurface } from './types.js';

export function answerFunctionPort(
  answer: (request: string) => Promise<string | undefined>,
  options: { id?: string; surface?: PrefetchSurface } = {},
): PrefetchPort {
  const id = options.id ?? 'test.answer';
  const surface = options.surface ?? 'vscode';
  return {
    registry: defineRegistry([
      { id, kind: 'answer', sideEffect: 'read', surfaces: [surface], patterns: [/\S/], examples: [], budgetMs: 60_000, labelKey: `prefetch.action.${id}` },
    ]),
    executors: {
      [id]: {
        run: async (request) => {
          const text = await answer(request);
          return text ? { actionId: id, text } : undefined;
        },
      },
    },
    ports: { surface },
  };
}
