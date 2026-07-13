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

// Session cache: resolved block ('' = resolved-but-empty), the raw psychometric
// profile behind it (null = resolved-but-absent), and the in-flight promise so
// concurrent mounts coalesce into a single round-trip. The profile is cached
// alongside the block so a PER-TURN consumer (augmentSystemPrompt) can appraise
// each message against the SAME once-per-session `/me` fetch — never re-fetching.
let sessionBlock: string | undefined;
let sessionProfile: PsychometricProfile | null | undefined;
let inflight: Promise<string> | undefined;

async function loadOnce(): Promise<string> {
  if (sessionBlock !== undefined) return sessionBlock;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const token = getStoredWebToken();
      if (!token) { sessionProfile = null; return ''; }
      const me = await getMe(token);
      sessionProfile = me.psychometric ?? null;
      return await fetchPersonalityBlock(me.psychometric);
    } catch {
      sessionProfile = null;
      return '';
    }
  })()
    .then((block) => {
      sessionBlock = block;
      return block;
    })
    .finally(() => {
      inflight = undefined;
    });
  return inflight;
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
  return sessionProfile ?? null;
}

/**
 * The signed-in user's personality directive block for the chat system prompt,
 * fetched once per session and cached. '' until it resolves and '' when the user
 * has no profile — safe to concatenate unconditionally.
 */
export function usePersonalityBlock(): string {
  const [block, setBlock] = useState<string>(sessionBlock ?? '');
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
  sessionBlock = undefined;
  sessionProfile = undefined;
  inflight = undefined;
}
