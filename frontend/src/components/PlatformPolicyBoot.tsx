'use client';

/**
 * THE COMPOSITION ROOT for the platform policy (G01/G02, web).
 *
 * Two boots, and they are not the same thing. `bootWebPlatformPolicy` restores
 * the person's explicit choices, or — when they have never been asked — leaves
 * every capability REFUSED, then sets the flag the root layout's head script
 * waits on. It does not write a durable record and it no-ops without `window`.
 * `bootWebHost({ network: 'denied' })` is the durable boot: one local record in
 * the store the first call keeps, replayed locally, with no platform fetch.
 *
 * Loaded with `next/dynamic` for the same reason `ReplayLoader` is: the root
 * closure is a ratchet (`check-root-closure`), and a statically imported module
 * is parsed on the first paint of every route. Booting restores one stored
 * object and registers one listener — it is not first-paint work, and nothing
 * in the shell renders as a result of it.
 *
 * It renders nothing. The calls are at module evaluation, not in an effect: an
 * effect runs after paint, and a child's effect runs before its parent's, so
 * deferring this would let a platform fetch leave first. `bootWebPlatformPolicy`
 * guards on `window`, so that half is a no-op on the server. The durable boot
 * does not: it is the node-callable host, and a second call reopens the store
 * the first call kept. The root layout's head script holds platform-origin
 * fetch until the policy call finishes, covering the gap before this chunk arrives.
 */
import {
  bootWebHost,
  bootWebPlatformPolicy,
  type BootWebHostOptions,
  type WebHostBoot,
} from '@/lib/localFirst/platformPolicy';

/** Stable id so a second boot reads the activation row instead of writing another. */
export const WEB_HOST_ACTIVATION_ID = 'web-host-activation';

export const WEB_HOST_ACTIVATION_TITLE = 'Web host activation';

let retained: WebHostBoot['store'] | undefined;
let written: Promise<string> | undefined;

/**
 * Durable activation. Policy flags still come from `bootWebPlatformPolicy`.
 * The record is written by `bootWebHost` with the network denied, into the
 * store this call keeps. A later call reopens that store; it does not write
 * a second row and it does not call platform fetch.
 */
export function activateDeniedWebHost(options?: {
  fetch?: BootWebHostOptions['fetch'];
}): WebHostBoot {
  bootWebPlatformPolicy();
  const host = bootWebHost({
    network: 'denied',
    ...(retained ? { store: retained } : {}),
    ...(options?.fetch ? { fetch: options.fetch } : {}),
  });
  retained = host.store;
  if (!written) {
    const writing = host;
    written = writing.writeDurable({
      id: WEB_HOST_ACTIVATION_ID,
      title: WEB_HOST_ACTIVATION_TITLE,
    }).then(async (id) => {
      await writing.replayBatch();
      return id;
    });
  }
  return host;
}

/** The in-flight (or finished) activation write. Absent until activation runs. */
export function webHostActivation(): Promise<string> {
  if (!written) throw new Error('web_host_not_activated');
  return written;
}

/** Store the first denied boot kept, so a second `bootWebHost` can read it back. */
export function deniedWebHostStore(): WebHostBoot['store'] | undefined {
  return retained;
}

bootWebPlatformPolicy();
activateDeniedWebHost();

export function PlatformPolicyBoot(): null {
  // Idempotent. A client render that races module evaluation still boots;
  // the retained store makes the second call a reopen, not a second record.
  bootWebPlatformPolicy();
  activateDeniedWebHost();
  return null;
}
