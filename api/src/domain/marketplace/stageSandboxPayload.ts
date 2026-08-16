/**
 * WHICH BUILD A SANDBOX RUN VERIFIED.
 *
 * ── WHY A HASH AND NOT THE SNAPSHOT ID ───────────────────────────────────────────
 * A sandbox run is expensive (a disposable container, a real Chromium) and a
 * snapshot id changes on every Stage press even when nothing that could change
 * runtime behaviour did — price and trial are policy, not product. Hashing only
 * the fields a sandbox could ever observe means re-staging an UNCHANGED board
 * reuses its clean run, and editing one card correctly invalidates it, without
 * either side having to reason about which snapshot id belongs to which run.
 *
 * `priceCents` and `trial` are deliberately excluded: they drive `sells.*`
 * checks only and can never change what a booted document does.
 *
 * ── WHY SHA-256 AND NOT `hashFields`'s FNV-1a-32 ─────────────────────────────────
 * `application/boardsync/reconciler.ts` hashes with a 32-bit FNV-1a for a
 * best-effort dedup where a collision just means one extra sync — cheap to be
 * wrong about. Here a hash COLLISION means the gate treats an unverified build as
 * verified, so this uses `crypto.subtle.digest('SHA-256', …)`, which is
 * Workers-native and needs no dependency.
 */

import type { ListingDelivery, ListingHarness } from '@builderforce/creation-canvas-contract';
import { stableStringify } from '../shared/stableStringify';

/** Only what a sandbox run could ever observe. */
export interface StageSandboxSubject {
  harness: ListingHarness;
  delivery: ListingDelivery;
  objects: readonly { id: string; kind: string; canvasData: unknown; content: unknown }[];
  strippedFields: readonly string[];
}

/** Hex-encode a digest without a Buffer, which Workers does not carry. */
function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 over the canonical form of what a sandbox run verified. */
export async function stageSandboxPayloadHash(subject: StageSandboxSubject): Promise<string> {
  const canonical = stableStringify({
    harness: subject.harness,
    delivery: subject.delivery,
    objects: subject.objects.map((object) => ({
      id: object.id,
      kind: object.kind,
      canvasData: object.canvasData,
      content: object.content,
    })),
    strippedFields: [...subject.strippedFields].sort(),
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return hex(digest);
}

/**
 * Only `runtime` (a real browser can drive a touch gesture) and `media` (a real
 * browser can measure a `loadedmetadata` duration) have anything a disposable
 * container can establish. `paged`/`geometry`/`instrument` are read from the
 * exact copy a buyer receives and stay static forever; `system` is verified by
 * an in-Worker stubbed dry-run of the real executor rather than a container
 * (see `application/workflow/systemDryRun.ts`); `deployment` already asks a
 * live address through its own probe.
 */
export function isSandboxApplicable(harness: ListingHarness): boolean {
  return harness === 'runtime' || harness === 'media';
}
