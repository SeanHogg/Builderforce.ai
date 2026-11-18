/**
 * An application's preview-origin key (make.md › PRD 31 §4 W10, control 1) — the `<key>` of
 * `https://<key>.preview.builderforce.ai`, the origin each browser-run application is served from.
 *
 * The SAME function as `previewOriginKey` in `@seanhogg/builderforce-webcontainers`
 * (`packages/browser/src/previewOrigin.ts`, release 2026.11.5): the first 128 bits of SHA-256 over
 * `bfwc-preview-origin\0<runtimeId>\0<applicationId>`, as 32 lowercase hex characters. The runtime
 * computes it page-side; the server recomputes it here so a worker egress policy is bound to an
 * origin derived from a project the caller owns, never to a key the client names. The package
 * version Builderforce installs does not export it yet, so it lives here once, with a test pinned
 * to the package's output for fixed inputs (`previewOriginKey.test.ts`) — if the runtime ever
 * changes the formula, that test is the tripwire.
 *
 * Builderforce starts every runtime with `id = String(projectId)`, and an application's stable id
 * has the form `app:<projectId>:<16 hex>` ({@link applicationIdPattern}).
 */
import { sha256Fingerprint } from '../../infrastructure/crypto/digest';

/** The runtime id Builderforce gives a project's runtime. */
export const runtimeIdOfProject = (projectId: number): string => String(projectId);

/** An application id that belongs to `projectId`: `app:<projectId>:<16 lowercase hex>`. */
export function applicationIdPattern(projectId: number): RegExp {
  return new RegExp(`^app:${projectId}:[0-9a-f]{16}$`);
}

/** The application's preview-origin key — byte-for-byte the runtime's `previewOriginKey(runtimeId, applicationId)`. */
export async function previewOriginKey(runtimeId: string, applicationId: string): Promise<string> {
  // 32 hex = 128 bits: the runtime's DNS label width (unique across projects in one browser profile).
  return sha256Fingerprint(`bfwc-preview-origin\u0000${runtimeId}\u0000${applicationId}`, 32);
}
