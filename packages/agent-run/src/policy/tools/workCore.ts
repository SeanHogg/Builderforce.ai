/**
 * workCore — in WORK mode a turn may never advertise fewer tools than the core
 * edit / read / run / search set, no matter how small the window-fit cap shrinks the
 * fixed set. Chat #80006 advertised "1–32 tools per turn" while earlier chats advertised
 * 67: a small window-fit cap let `selectToolsForTurn` trim below the core set, leaving
 * the model unable to edit, read, run or search without a router round trip.
 *
 * The core set here is the shared role-core names (`coreToolNames`) plus the
 * navigation/inspection companions a host advertises under its own names — the same
 * data `roleCap.ts` already keeps, so the work floor and the role cap never disagree.
 * This module is ADDITIVE: a turn that already advertises every core name is returned
 * unchanged (same array identity, so callers can rely on stability), and when the
 * catalog genuinely cannot fit a core tool it is reported through `onDropped` rather
 * than silently left out.
 *
 * Pure; no `node:*`, no DOM.
 */

import type { ToolSchema } from "@builderforce/agent-tools";
import { coreToolNames } from "./catalog.js";
import { ROLE_COMPANION_TOOLS, type CappedToolRole } from "./roleCap.js";

/**
 * The work-mode floor: the shared role-core edit/read/run/search names plus the
 * host-named navigation/inspection companions a code or verify turn relies on.
 */
export function workCoreToolNames(role: string): string[] {
  return [
    ...new Set([
      ...coreToolNames(role),
      ...ROLE_COMPANION_TOOLS[(role === "verify" ? "verify" : "code") as CappedToolRole],
    ]),
  ];
}

/**
 * Ensure `selected` (a `selectToolsForTurn` result's `tools`) advertises every core
 * edit/read/run/search name the catalog holds. Missing core names are appended in
 * catalog order; a core name the catalog does not hold is ignored. When `work` is false
 * (a non-work turn) the selection is returned untouched. A core name that would exceed
 * `capacity` is NOT appended — instead `onDropped` is told the window could not fit it,
 * so a work turn never silently advertises fewer than the core set.
 */
export function ensureWorkCoreSet(
  selected: readonly ToolSchema[],
  catalog: readonly ToolSchema[],
  opts: { role?: string; work?: boolean; capacity?: number; onDropped?: (name: string, reason: string) => void },
): ToolSchema[] {
  if (opts.work === false) return [...selected];
  const core = workCoreToolNames(opts.role ?? "code");
  const byName = new Map<string, ToolSchema>();
  for (const tool of catalog) {
    const name = tool.function?.name;
    if (name && !byName.has(name)) byName.set(name, tool);
  }
  const have = new Set(selected.map((t) => t.function?.name ?? ""));
  const capacity = opts.capacity ?? Number.POSITIVE_INFINITY;
  const out = [...selected];
  for (const name of core) {
    const tool = byName.get(name);
    if (!tool || have.has(name)) continue;
    if (out.length >= capacity) {
      opts.onDropped?.(name, `work-mode window could not fit the core tool set (${out.length} of ${out.length + 1} advertised)`);
      continue;
    }
    out.push(tool);
    have.add(name);
  }
  return out;
}
