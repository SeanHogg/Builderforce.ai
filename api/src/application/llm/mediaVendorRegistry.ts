/**
 * The vendor-registry primitive shared by every media surface (image, video).
 *
 * A media registry is ONE ordered list of vendor modules; everything else —
 * the by-id map, the `<vendor>/` prefixes, which vendors have credentials,
 * the tier of a model, and the interleaved pools the cascade walks — is derived
 * from that list here, once. The image and video registries each instantiate it
 * with their own modules and add only what is genuinely theirs (dispatch).
 */

export type MediaModelTier = 'FREE' | 'STANDARD' | 'PREMIUM' | 'ULTRA';

export interface MediaModelEntry {
  id: string;
  label: string;
  brand: string;
  tier: MediaModelTier;
}

/** The registry-facing half of a vendor module; each surface extends it with
 *  its own generate/start/poll methods. */
export interface MediaVendorModuleBase<Id extends string, Env> {
  id: Id;
  catalog: ReadonlyArray<MediaModelEntry>;
  apiKeyFrom(env: Env): string | null;
  tierFor(modelId: string): MediaModelTier;
}

export interface MediaVendorRegistry<Id extends string, Env, M extends MediaVendorModuleBase<Id, Env>> {
  /** Every vendor id, in priority order. */
  ids(): Id[];
  module(id: Id): M;
  /** Parse `<vendor>/<model>`; null for a bare id. */
  parsePrefix(modelId: string): { vendor: Id; modelId: string } | null;
  /** The vendor that owns a (prefixed or bare) model id. */
  vendorFor(modelId: string): Id;
  /** Vendor + the vendor-native (un-prefixed) model id. */
  resolve(modelId: string): { vendorId: Id; vendorModel: string };
  keyBound(env: Env, vendor: Id): boolean;
  anyBound(env: Env): boolean;
  tierFor(modelId: string): MediaModelTier;
  /**
   * Catalog ids of the given tiers, VENDOR-PREFIXED and INTERLEAVED across
   * vendors: round 1 takes each vendor's first model in priority order, round 2
   * each vendor's second, and so on. Prefixed so dispatch never resolves a model
   * by an ambiguous bare id; interleaved so a small free-attempt budget reaches
   * several VENDORS instead of spending itself on one vendor's outage.
   */
  modelsByTierPrefixed(...tiers: MediaModelTier[]): string[];
}

export function createMediaVendorRegistry<Id extends string, Env, M extends MediaVendorModuleBase<Id, Env>>(
  modules: ReadonlyArray<M>,
  defaultVendor: Id,
): MediaVendorRegistry<Id, Env, M> {
  const byId = new Map<Id, M>(modules.map((m) => [m.id, m]));
  const ownerOf = new Map<string, Id>();
  for (const mod of modules) for (const entry of mod.catalog) ownerOf.set(entry.id, mod.id);

  const parsePrefix = (modelId: string): { vendor: Id; modelId: string } | null => {
    for (const mod of modules) {
      const prefix = `${mod.id}/`;
      if (modelId.startsWith(prefix)) return { vendor: mod.id, modelId: modelId.slice(prefix.length) };
    }
    return null;
  };
  const vendorFor = (modelId: string): Id => parsePrefix(modelId)?.vendor ?? ownerOf.get(modelId) ?? defaultVendor;
  const resolve = (modelId: string): { vendorId: Id; vendorModel: string } => {
    const prefix = parsePrefix(modelId);
    return prefix ? { vendorId: prefix.vendor, vendorModel: prefix.modelId } : { vendorId: vendorFor(modelId), vendorModel: modelId };
  };
  const module = (id: Id): M => {
    const mod = byId.get(id);
    if (!mod) throw new Error(`Unknown media vendor: ${id}`);
    return mod;
  };

  return {
    ids: () => modules.map((m) => m.id),
    module,
    parsePrefix,
    vendorFor,
    resolve,
    keyBound: (env, vendor) => !!module(vendor).apiKeyFrom(env),
    anyBound: (env) => modules.some((m) => !!m.apiKeyFrom(env)),
    tierFor: (modelId) => {
      const { vendorId, vendorModel } = resolve(modelId);
      return module(vendorId).tierFor(vendorModel);
    },
    modelsByTierPrefixed: (...tiers) => {
      const wanted = new Set(tiers);
      const perVendor = modules.map((mod) => mod.catalog.filter((m) => wanted.has(m.tier)).map((m) => `${mod.id}/${m.id}`));
      const rounds = Math.max(0, ...perVendor.map((ids) => ids.length));
      const out: string[] = [];
      for (let round = 0; round < rounds; round++) {
        for (const ids of perVendor) {
          const id = ids[round];
          if (id) out.push(id);
        }
      }
      return out;
    },
  };
}
