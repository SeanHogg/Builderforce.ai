/**
 * Test stand-in for a tenant runtime being online.
 *
 * A vendor that declares `requiresLocalEgress` is SKIPPED by `dispatchInternal` when no
 * egress transport is supplied — that is the whole point of the flag, since the Worker's
 * own egress is exactly what those upstreams refuse. A test that means to exercise the
 * vendor's REQUEST SHAPE therefore has to say "a runtime is online" first, or it asserts
 * against a cascade that never dispatched.
 *
 * Forwarding to `globalThis.fetch` keeps every such test's existing mock intact: the
 * transport is the only thing that changes, and the request the vendor built arrives at
 * the same spy it always did.
 */
import type { VendorEgress } from '../types';

export const passthroughEgress: VendorEgress = (endpoint, init, signal) =>
  globalThis.fetch(endpoint, signal ? { ...init, signal } : init);
