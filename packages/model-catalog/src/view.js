/**
 * The CatalogView port — how a pure router reads a host's model catalog without
 * importing it.
 *
 * The Worker binds it to its vendor registry plus a price book built from the live
 * provider catalog; an on-prem or editor host binds it to whatever catalog it holds.
 * The router never learns where the answers came from, which is what lets the same
 * ranking code run in the cloud, in the editor and offline.
 */
/** Residency through the optional port method — `cloud` when the host doesn't say. */
export function residencyOf(view, model) {
    return view.residencyOf?.(model) ?? 'cloud';
}
//# sourceMappingURL=view.js.map