/**
 * Per-attempt vendor deadline — the ONE resolution of "how long may THIS candidate take".
 *
 * The plan sets a single budget per dispatch (`FREE_VENDOR_CALL_TIMEOUT_MS` 15s, the 25s
 * default, the 60s premium budget). That budget is applied to every candidate in the
 * chain, so a frontier model inherited the free plan's fast-fail number: 2026-10-03..10
 * shows `anthropic/claude-opus-5-5` timing out 15x, `googleai/gemini-2.5-flash` 34x and
 * NIM Nemotron 37x — every one at exactly 15000ms. A strict-pinned Opus turn has no
 * fallback, so the timeout WAS the failure.
 *
 * Vendors now declare their own budget as data (`VendorModule.attemptTimeoutMs`); this
 * module turns that declaration plus the plan's requested budget into the deadline one
 * attempt gets. A declaration is a FLOOR — it raises a short plan budget for a slow model
 * and never shortens a caller's longer one — clamped so no declaration can hold a Worker
 * isolate open indefinitely.
 */

import { DEFAULT_VENDOR_CALL_TIMEOUT_MS, type VendorModule } from './types';

/**
 * Ceiling on any DECLARED per-attempt budget. 90s covers a non-streaming thinking turn
 * on a frontier model; a declaration above it is clamped. A caller's own longer budget
 * (already clamped by `MAX_VENDOR_CALL_TIMEOUT_MS` at its seam) is never reduced.
 */
export const MAX_DECLARED_ATTEMPT_TIMEOUT_MS = 90_000;

/** The budget `mod` declares for `vendorModel` (its own, un-prefixed id), if any. */
export function declaredAttemptTimeoutMs(
  mod: Pick<VendorModule, 'attemptTimeoutMs'>,
  vendorModel: string,
): number | undefined {
  const decl = mod.attemptTimeoutMs;
  if (!decl) return undefined;
  const value = decl.byModel?.[vendorModel] ?? decl.default;
  return value && value > 0 ? value : undefined;
}

/**
 * The deadline one attempt runs under. `requested` is the dispatch's budget (absent =
 * the transport default); `declared` is the model's declaration. Returns `requested`
 * unchanged when nothing is declared, so a vendor without a declaration behaves exactly
 * as before.
 */
export function resolveAttemptTimeoutMs(
  requested: number | undefined,
  declared: number | undefined,
): number | undefined {
  if (!declared) return requested;
  const base = requested && requested > 0 ? requested : DEFAULT_VENDOR_CALL_TIMEOUT_MS;
  const floor = Math.min(declared, MAX_DECLARED_ATTEMPT_TIMEOUT_MS);
  return Math.max(base, floor);
}
