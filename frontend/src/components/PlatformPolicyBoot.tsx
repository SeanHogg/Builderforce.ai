'use client';

/**
 * THE COMPOSITION ROOT for the platform policy (G01/G02, web).
 *
 * `bootWebPlatformPolicy` derives the snapshot from the person's inference mode
 * and explicit overrides — signed out and never asked, Local only: every
 * capability REFUSED; signed in and never asked, Hybrid — then sets the flag
 * the root layout's head script waits on. Setting that flag RELEASES the
 * platform-origin requests the head script held while this chunk loaded; from
 * then on the real policy decides them. It writes no durable record and no-ops
 * without `window`.
 *
 * Activation does nothing else. The durable denied-host proof (one local
 * record, reopened, replayed locally with no platform fetch) is acceptance-test
 * scaffolding and lives in `lib/localFirst/deniedNetworkAcceptance.test.ts`,
 * not in a runtime entry point that would write a ticket on every page load.
 *
 * Loaded with `next/dynamic` for the same reason `ReplayLoader` is: the root
 * closure is a ratchet (`check-root-closure`), and a statically imported module
 * is parsed on the first paint of every route. Booting restores one stored
 * object and registers one listener — it is not first-paint work, and nothing
 * in the shell renders as a result of it.
 *
 * It renders nothing. The call is at module evaluation, not in an effect: an
 * effect runs after paint, and a child's effect runs before its parent's, so
 * deferring this would keep held platform requests waiting longer than needed.
 */
import { bootWebPlatformPolicy } from '@/lib/localFirst/platformPolicy';

bootWebPlatformPolicy();

export function PlatformPolicyBoot(): null {
  // Idempotent. A client render that races module evaluation still boots.
  bootWebPlatformPolicy();
  return null;
}
