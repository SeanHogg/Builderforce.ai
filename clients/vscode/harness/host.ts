/**
 * The non-network half of a VSIX chat, in memory.
 *
 * The Brain run loop persists through one narrow port (`sendMessages`) and dispatches
 * tools through another (`runTool`). In the extension those reach the API and the
 * workspace; here they reach a `Map` and a table of canned results — which is enough to
 * drive the loop end-to-end, and is what makes a scenario run in milliseconds instead of
 * a build-install-chat cycle.
 *
 * Two things are deliberately REAL rather than stubbed:
 *   - message shape. `buildTranscript` and the diagnostics reader both walk
 *     `BrainMessage[]`, including the durable `role:'tool'` STEP rows the loop writes.
 *     A fake that dropped or reshaped those would validate a transcript no user ever
 *     sees.
 *   - tool SPECS. The scenarios use the extension's actual `TOOL_DEFS`, so per-turn tool
 *     selection scores against the real names and schemas.
 */

import type { BrainAction, BrainMessage } from '@seanhogg/builderforce-brain-embedded';
import { TOOL_DEFS } from '../src/fileTools';

/** An in-memory chat store that satisfies the loop's persistence port. */
export interface HarnessPersistence {
  sendMessages(
    chatId: number,
    messages: Array<{ role: string; content: string; metadata?: string }>,
  ): Promise<BrainMessage[]>;
  /** Everything persisted for a chat, in order — user turns, assistant turns, step rows. */
  messages(chatId: number): BrainMessage[];
}

/**
 * A message store. `now` is injected as a monotonic counter rather than read from the
 * clock so a scenario's transcript is byte-stable and can be asserted on directly.
 */
export function memoryPersistence(): HarnessPersistence {
  const byChat = new Map<number, BrainMessage[]>();
  let nextId = 1;
  let tick = 0;

  return {
    async sendMessages(chatId, messages) {
      const list = byChat.get(chatId) ?? [];
      const persisted = messages.map((m) => {
        tick += 1;
        const msg: BrainMessage = {
          id: nextId++,
          role: m.role,
          content: m.content,
          metadata: m.metadata ?? null,
          seq: list.length + 1,
          // A fixed epoch plus the tick keeps ordering real while the text stays stable.
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + tick * 1000).toISOString(),
        };
        list.push(msg);
        return msg;
      });
      byChat.set(chatId, list);
      return persisted;
    },
    messages(chatId) {
      return [...(byChat.get(chatId) ?? [])];
    },
  };
}

/** How a harness tool call is answered. A function gets the args; anything else is
 *  returned verbatim (an `{ ok:false, error }` object models a failing tool). */
export type ToolResponder = unknown | ((args: unknown) => unknown | Promise<unknown>);

export interface HarnessTools {
  /** Advertised to the model, in the shape `startRun` takes. */
  specs: BrainAction[];
  /** The dispatcher `startRun` calls. */
  runTool(name: string, args: unknown): Promise<unknown>;
  /** Every dispatch that happened, in order. */
  calls: Array<{ name: string; args: unknown }>;
}

/**
 * Build a tool surface for a scenario.
 *
 * `names` selects which tools exist. It defaults to the extension's REAL local file
 * tools plus the platform tools a chat run actually leans on, because "which tools were
 * on offer" is itself a thing the scenarios assert (a run that narrates a call it was
 * never given is a different bug from one that ignores a tool it had).
 *
 * `responses` maps a tool name to its canned result; anything unmapped returns a benign
 * `{ ok: true }` so a scenario only has to state the results it cares about.
 */
export function harnessTools(opts: {
  names?: string[];
  responses?: Record<string, ToolResponder>;
  /** Register no tools at all — models a failed catalog fetch. */
  none?: boolean;
} = {}): HarnessTools {
  const calls: Array<{ name: string; args: unknown }> = [];
  const responses = opts.responses ?? {};

  const localSpecs: BrainAction[] = TOOL_DEFS.map((def) => ({
    name: def.name,
    description: def.description,
    parameters: def.parameters,
    mutates: def.mutating,
    run: async () => ({ ok: true }),
  }));

  // A small stand-in for the gateway MCP catalog: real names + shapes for the platform
  // tools a chat run leans on, so tool SELECTION behaves as it does in the product.
  const platformSpecs: BrainAction[] = [
    ['builtin_chats_list_tickets', 'List the work items linked to a chat.', { chatId: 'number' }],
    ['builtin_chats_link_ticket', 'Link a work item to a chat.', { chatId: 'number', kind: 'string', ref: 'string' }],
    ['builtin_tasks_list', 'List tasks (tickets) on the board, filterable by status.', { projectId: 'number', status: 'string' }],
    ['builtin_tasks_update', 'Update a task: status, assignee, title.', { id: 'number', status: 'string' }],
    ['builtin_tasks_create', 'Create a task, epic or gap on the board.', { projectId: 'number', title: 'string' }],
    ['builtin_tickets_from_delta', 'Record a code change as a ticket linked to a chat.', { projectId: 'number', summary: 'string' }],
    ['builtin_projects_list', 'List the projects in this workspace.', {}],
  ].map(([name, description, props]) => ({
    name: name as string,
    description: description as string,
    parameters: {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(props as Record<string, string>).map(([k, t]) => [k, { type: t }]),
      ),
    },
    mutates: /create|update|link|from_delta/.test(name as string),
    run: async () => ({ ok: true }),
  }));

  const all = [...localSpecs, ...platformSpecs];
  const selected = opts.none
    ? []
    : opts.names
      ? all.filter((a) => opts.names!.includes(a.name))
      : all;

  return {
    specs: selected,
    calls,
    async runTool(name, args) {
      calls.push({ name, args });
      const responder = responses[name];
      if (typeof responder === 'function') return (responder as (a: unknown) => unknown)(args);
      if (responder !== undefined) return responder;
      return { ok: true };
    },
  };
}
