/**
 * The PUBLIC provenance lookup, cached: what `GET /api/voice-provenance/verify` answers.
 *
 * Lives here rather than in the route so the presentation layer never reaches the cache
 * (`check-layering`). A VALID verdict is cached for a short TTL; an invalid one (not found,
 * bad signature) is returned but never cached, so a clip registered a moment later is found.
 */
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { verifyVoiceProvenancePublic, type ProvenanceLookup, type PublicVoiceProvenance } from './voiceProvenanceService';
import { createVoiceProvenancePorts } from './voiceProvenancePorts';

/** Carries a verdict out of the cache loader without caching it. */
class Uncacheable extends Error {
  constructor(readonly verdict: PublicVoiceProvenance) { super('uncacheable'); }
}

function cacheKeyFor(by: ProvenanceLookup, claimedHash?: string): string {
  const base = 'watermarkId' in by ? `voiceprov:wm:${by.watermarkId}`
    : 'audioSha256' in by ? `voiceprov:sha:${by.audioSha256}`
    : `voiceprov:clip:${by.clipId}`;
  // The view carries the hash comparison, so it is part of what is cached.
  return claimedHash ? `${base}:claim:${claimedHash}` : base;
}

export async function lookupVoiceProvenancePublic(
  db: Db,
  env: Env,
  by: ProvenanceLookup,
  claimedHash?: string,
): Promise<PublicVoiceProvenance> {
  const ports = createVoiceProvenancePorts(db, env);
  return getOrSetCached(
    env,
    cacheKeyFor(by, claimedHash),
    async () => {
      const v = await verifyVoiceProvenancePublic(ports, by, claimedHash);
      if (!v.valid) throw new Uncacheable(v);
      return v;
    },
    // The manifest is immutable, but the public view names the voice, which can
    // be renamed or unpublished — keep the TTL short.
    { kvTtlSeconds: 300 },
  ).catch((err: unknown) => {
    if (err instanceof Uncacheable) return err.verdict;
    throw err;
  });
}
