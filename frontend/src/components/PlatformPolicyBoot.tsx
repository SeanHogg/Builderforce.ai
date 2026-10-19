'use client';

/**
 * THE COMPOSITION ROOT for the platform policy (G01/G02, web).
 *
 * `bootWebPlatformPolicy` restores the person's explicit choices, or — when they
 * have never been asked — leaves every capability REFUSED. Until this module is
 * mounted somewhere, the boot function has no caller and the web is a surface
 * that has a policy module but no policy: the transport reads whatever the
 * module-load default happened to be, and nothing restores a stored choice on
 * reload. So it is mounted once, here.
 *
 * Loaded with `next/dynamic` for the same reason `ReplayLoader` is: the root
 * closure is a ratchet (`check-root-closure`), and a statically imported module
 * is parsed on the first paint of every route. Booting restores one stored
 * object and registers one listener — it is not first-paint work, and nothing
 * in the shell renders as a result of it.
 *
 * It renders nothing. The call is at module evaluation, not in an effect: an
 * effect runs after paint, and a child's effect runs before its parent's, so
 * deferring this would let a platform fetch leave first. The module guards on
 * `window`, so the server evaluation is a no-op. The root layout's head script
 * holds platform-origin fetch until this call finishes, covering the gap before
 * this chunk arrives.
 */
import { bootWebPlatformPolicy } from '@/lib/localFirst/platformPolicy';

bootWebPlatformPolicy();

export function PlatformPolicyBoot(): null {
  // Idempotent. A client render that races module evaluation still boots;
  // `booted` makes the second call a no-op and does not add a second listener.
  bootWebPlatformPolicy();
  return null;
}
