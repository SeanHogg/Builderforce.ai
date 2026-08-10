'use client';

/**
 * usePersonalityBlock — the single seam that threads the signed-in HUMAN user's
 * personality into the Brain chat's system prompt (Gap 2/3, client half).
 *
 * It fetches the user's psychometric profile from `GET /api/auth/me` ONCE per
 * session, compiles it to a directive block via the shared gateway compiler, and
 * caches the result module-level so co-mounted Brain panels (the full-page Brain
 * Storm route + the docked drawer) and remounts share ONE fetch — never one per
 * message. Consumers fold the returned string into their ambient `extraSystem`
 * channel, so it is a no-op ('') when the user has no profile.
 *
 * Human personality shapes TONE only: the block is prompt directives (rendered by
 * the server's `buildPsychometricBlock`), never execution params.
 */
import { useEffect, useState } from 'react';
import { getStoredWebToken, getMe } from './auth';
import { fetchPersonalityBlock } from './personalityApi';
import type { PsychometricProfile } from './psychometric';
import { getOrSetClientCached, invalidateClientCache, readClientCached } from '@/infrastructure/http/readThrough';

// Session cache: resolved block ('' = resolved-but-empty), the raw psychometric
// profile behind it (null = resolved-but-absent), and the in-flight promise so
// concurrent mounts coalesce into a single round-trip. The profile is cached
// alongside the block so a PER-TURN consumer (augmentSystemPrompt) can appraise
// each message against the SAME once-per-session `/me` fetch — never re-fetching.
interface PersonalitySession { block: string; profile: PsychometricProfile | null }
const CACHE_KEY = 'personality:session';

async function loadOnce(): Promise<string> {
  const session = await getOrSetClientCached<PersonalitySession>(CACHE_KEY, async () => {
    try {
      const token = getStoredWebToken();
      if (!token) return { block: '', profile: null };
      const me = await getMe(token);
      return { block: await fetchPersonalityBlock(me.psychometric), profile: me.psychometric ?? null };
    } catch {
      return { block: '', profile: null };
    }
  });
  return session.block;
}

/**
 * The signed-in user's cached psychometric profile — resolved by the SAME
 * once-per-session `/me` fetch that backs {@link usePersonalityBlock}. Awaiting
 * this coalesces with (or reuses) that fetch, so a per-turn caller pays only the
 * appraisal round-trip, never a second `/me`. Resolves `null` when the user has
 * no profile (or isn't signed in).
 */
export async function getSessionPsychometric(): Promise<PsychometricProfile | null> {
  await loadOnce();
  return readClientCached<PersonalitySession>(CACHE_KEY)?.profile ?? null;
}

/**
 * The signed-in user's personality directive block for the chat system prompt,
 * fetched once per session and cached. '' until it resolves and '' when the user
 * has no profile — safe to concatenate unconditionally.
 */
export function usePersonalityBlock(): string {
  const [block, setBlock] = useState<string>(readClientCached<PersonalitySession>(CACHE_KEY)?.block ?? '');
  useEffect(() => {
    let live = true;
    void loadOnce().then((b) => {
      if (live) setBlock(b);
    });
    return () => {
      live = false;
    };
  }, []);
  return block;
}

/** Invalidate the cached personality block (e.g. on sign-out or after the user
 *  edits their personality) so the next mount re-fetches it. */
export function clearPersonalityBlockCache(): void {
  invalidateClientCache(CACHE_KEY);
}
