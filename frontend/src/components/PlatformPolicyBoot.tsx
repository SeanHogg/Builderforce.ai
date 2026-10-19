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
 * It renders nothing. The boot runs in an effect, so it cannot run during the
 * server render (the module guards on `window` itself, but there is no stored
 * choice on the server to restore).
 */
import { useEffect } from 'react';
import { bootWebPlatformPolicy } from '@/lib/localFirst/platformPolicy';

export function PlatformPolicyBoot(): null {
  useEffect(() => {
    bootWebPlatformPolicy();
  }, []);
  return null;
}