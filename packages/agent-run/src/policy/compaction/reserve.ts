/**
 * policy/compaction/reserve — the reserve tokens.
 *
 * The tokens the packer holds back so the serving model has room to answer.
 *   - The reply reserve is the shared hand-off rule (`@builderforce/run-policy`
 *     `DEFAULT_HANDOFF_RESERVE_TOKENS` / `handoffReserveTokens`), bound here, never restated.
 *   - The FLOOR is on-prem's (`agent-runtime/src/agents/agent-settings.ts`, which
 *     `agents/embedded-runner/compact.ts` applies before every compaction): the reserve
 *     never sits below `DEFAULT_PI_COMPACTION_RESERVE_TOKENS_FLOOR` (20,000) unless the
 *     config names another floor. Ported faithfully — same names, same signatures, same
 *     value — so its tests run here unchanged.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node.
 */

import { DEFAULT_HANDOFF_RESERVE_TOKENS, cappedMaxTokens, handoffReserveTokens, nextTurn } from "@builderforce/run-policy";
import type { PolicyContext } from "../hooks.js";

/** Tokens held back for the reply when a request names no `max_tokens` — the shared hand-off default. */
export const DEFAULT_COMPACT_RESERVE_TOKENS = DEFAULT_HANDOFF_RESERVE_TOKENS;

/** The reserve the packer holds back: `maxTokens` when the request names one, else the default. */
export const compactReserveTokens: (maxTokens: number | undefined) => number = handoffReserveTokens;

/** On-prem's reserve floor — the reserve never sits below it unless the config names another. */
export const DEFAULT_PI_COMPACTION_RESERVE_TOKENS_FLOOR = 20_000;

/** The slice of the on-prem config the floor reads (`BuilderForceAgentsConfig`, structurally). */
export interface CompactionReserveConfig {
  agents?: { defaults?: { compaction?: { reserveTokensFloor?: number } } };
}

/** The settings the floor is enforced on — on-prem's pi `SettingsManager`, or an in-memory one. */
export type SettingsManagerLike = {
  getCompactionReserveTokens: () => number;
  applyOverrides: (overrides: { compaction: { reserveTokens: number } }) => void;
};

/** Bump the reserve to the floor when it sits under it. */
export function ensureCompactionReserveTokens(params: {
  settingsManager: SettingsManagerLike;
  minReserveTokens?: number;
}): { didOverride: boolean; reserveTokens: number } {
  const minReserveTokens = params.minReserveTokens ?? DEFAULT_PI_COMPACTION_RESERVE_TOKENS_FLOOR;
  const current = params.settingsManager.getCompactionReserveTokens();

  if (current >= minReserveTokens) {
    return { didOverride: false, reserveTokens: current };
  }

  params.settingsManager.applyOverrides({
    compaction: { reserveTokens: minReserveTokens },
  });

  return { didOverride: true, reserveTokens: minReserveTokens };
}

/** The floor the config names, else the default. Zero is a legal floor. */
export function resolveCompactionReserveTokensFloor(cfg?: CompactionReserveConfig): number {
  const raw = cfg?.agents?.defaults?.compaction?.reserveTokensFloor;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return Math.floor(raw);
  }
  return DEFAULT_PI_COMPACTION_RESERVE_TOKENS_FLOOR;
}

/**
 * The reserve a compaction holds back: the reply reserve, raised to the floor through
 * {@link ensureCompactionReserveTokens} — the same call on-prem makes, over an in-memory
 * settings record.
 */
export function compactionReserve(maxTokens: number | undefined, cfg?: CompactionReserveConfig): number {
  let reserveTokens = compactReserveTokens(maxTokens);
  return ensureCompactionReserveTokens({
    settingsManager: {
      getCompactionReserveTokens: () => reserveTokens,
      applyOverrides: (o) => {
        reserveTokens = o.compaction.reserveTokens;
      },
    },
    minReserveTokens: resolveCompactionReserveTokensFloor(cfg),
  }).reserveTokens;
}

/** The model that serves the turn about to be asked: what the model policy last settled on (a failover moves it), else the pin. */
export function servingModel(ctx: PolicyContext): string {
  return ctx.state.model?.model ?? ctx.policy.pinnedModel ?? "";
}

/** The reply ceiling the turn about to be asked is given: its role's cap (`cappedMaxTokens`), else the shared hand-off default. */
function turnCeiling(ctx: PolicyContext): number {
  return compactReserveTokens(cappedMaxTokens(nextTurn(ctx.state.model, { hasTools: ctx.tools.length > 0 }).role, undefined));
}

/**
 * THE reply reserve of the turn about to be asked - the one number compaction and the model hand-off hold back, and the bound on the
 * request's own `maxTokens` ({@link replyAsk}).
 *
 * A run that never hands off between models holds back what its policy states, else the host-neutral floor (`compactionReserve`).
 * A run that does (`RunPolicy.modelHandoff`) can land on ANY window, so the reserve follows the model now serving: on-prem's floor
 * (or the turn's role cap, when that is larger) but never more than a quarter of that window. A 200K window holds back 20K, a 64K
 * window 16K, a 16K window 4K.
 */
export function replyReserve(ctx: PolicyContext): number {
  if (!ctx.policy.modelHandoff) return ctx.policy.budgets.reserveTokens ?? compactionReserve(undefined);
  const wanted = Math.max(turnCeiling(ctx), DEFAULT_PI_COMPACTION_RESERVE_TOKENS_FLOOR);
  const window = ctx.ports.model.window?.(servingModel(ctx));
  return window && window > 0 ? Math.max(1, Math.min(wanted, Math.floor(window / 4))) : wanted;
}

/**
 * What a hand-off run's request asks as its `maxTokens`: the turn's role cap, clamped to the reserve only when the window forces it,
 * so the input that fits plus the reply asked for always fit the window.
 */
export function replyAsk(ctx: PolicyContext): number {
  return Math.min(turnCeiling(ctx), replyReserve(ctx));
}
