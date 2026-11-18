/**
 * The external API origins a project declares for its browser-run apps' process Workers
 * (make.md › PRD 31 §4 W10, control 6) — the only origins a worker egress policy adds on top
 * of the default allowlist.
 *
 * Nothing declares them yet: neither `AppBlueprint` (`@builderforce/creation-canvas-contract`)
 * nor `builderforce.json` has an external-API field, so every app gets the default allowlist
 * only (gap logged in ROADMAP.md › Consolidated Gap Register). There is no stored declaration to
 * read, so there is nothing to put behind `getOrSetCached` yet; when the declaration lands, this
 * reads it through `getOrSetCached` keyed per project and the declaration's write path
 * invalidates that key (or, with no write path, the TTL alone bounds it). Write-capable APIs are
 * never a default.
 */
export async function declaredExternalApiOrigins(_projectId: number): Promise<readonly string[]> {
  return [];
}
