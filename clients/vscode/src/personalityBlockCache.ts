/**
 * The session cache for the STATIC personality layers — keyed on the persona context, so
 * a user / persona switch re-fetches while repeated turns reuse it.
 *
 * Only an ANSWER is cached. The fetch reports a failure as `null` (signed out, offline,
 * a platform-policy denial, a non-2xx) and a neutral profile as an empty answer; caching
 * the failure for the session is what left personality off until the editor restarted,
 * even after the gateway became reachable. A failure now returns `null` for this call and
 * is asked again on the next.
 *
 * Pure: the transport is passed per call (`personalityLimbic.ts` `requestPersonalityLayers`).
 */
export interface PersonalityBlockCache<P, V> {
  get(persona: P | undefined, fetchValue: () => Promise<V | null>): Promise<V | null>;
  clear(): void;
}

export function createPersonalityBlockCache<P, V = string>(): PersonalityBlockCache<P, V> {
  let cached: { key: string; value: V } | undefined;
  return {
    async get(persona, fetchValue) {
      const key = JSON.stringify(persona ?? {});
      if (cached && cached.key === key) return cached.value;
      const value = await fetchValue();
      if (value === null) return null;
      cached = { key, value };
      return value;
    },
    clear() {
      cached = undefined;
    },
  };
}
