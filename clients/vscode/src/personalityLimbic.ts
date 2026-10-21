/**
 * The editor's personality + affect layers for a turn's system prompt — the static
 * PERSONALITY tone the gateway compiles from the signed-in person's stored profile, and
 * the per-turn AFFECT appraised on this machine.
 *
 *   - Personality is resolved server-side (the profile is stored there, by user id), so
 *     it is fetched from `POST /api/limbic/block` ONCE per session and cached — the
 *     persona tone, the resting affect, and the personality's limbic setpoints.
 *   - The per-turn affect is Evermind's local limbic (brain-embedded `turnAffectBlock`),
 *     seeded from those cached setpoints. Until 2026-10-21 every turn POSTed its text
 *     to the gateway for this; now no turn makes a request for it, and signed out or
 *     offline the turn still gets a (neutral-seeded) affect block.
 *
 * Lifted out of `gateway.ts`, which had grown to hold it beside the completion client.
 */

import type * as vscode from "vscode";
import { turnAffectBlock, type LimbicState } from "@seanhogg/builderforce-brain-embedded";
import { getApiKey, getBaseUrl } from "./gateway";
import { createPersonalityBlockCache } from "./personalityBlockCache";

/**
 * Personality/persona context sent to `POST /api/limbic/block` so the returned
 * directive block carries PERSONALITY (setpoints + psychometric directives), not
 * just the affective appraisal of the text. Every field is optional and
 * backward-compatible — an empty body still yields the neutral limbic block.
 *
 *   - `userId`      : the signed-in HUMAN whose personality shapes chat TONE. The
 *                     gateway resolves their stored psychometric profile.
 *   - `psychometric`: an explicit profile, when the caller already holds it.
 *   - `agentId`     : the active agent persona, when the chat runs AS an agent.
 *   - `personaId`   : a saved platform persona id, when one is active.
 */
export interface PersonaContext {
  userId?: string;
  psychometric?: unknown;
  agentId?: string | number;
  personaId?: string | number;
}

/** The session's personality, as the gateway compiled it. */
interface PersonalityLayers {
  /** The resting affect of the personality (`block` for an empty text). */
  restBlock: string;
  /** The static personality tone (`personaBlock`). */
  personaBlock: string;
  /** The personality's limbic setpoints — the seed of every turn's local appraisal. */
  setpoints: LimbicState | null;
}

const nonEmpty = (s: string | undefined | null): s is string => typeof s === "string" && s.trim().length > 0;

/**
 * The ONE transport to the personality endpoint. Distinguishes a FAILURE (`null`:
 * signed out, offline, denied by the platform policy, a non-2xx, a bad body) from an
 * answer (a neutral profile is an answer with empty layers). Only an answer may be
 * cached — a failure cached for the session left personality off until the editor
 * restarted. Signed out it returns before any request.
 */
async function requestPersonalityLayers(secrets: vscode.SecretStorage, persona?: PersonaContext): Promise<PersonalityLayers | null> {
  try {
    const key = await getApiKey(secrets);
    if (!key) return null;
    const res = await fetch(`${getBaseUrl()}/api/limbic/block`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ text: "", ...(persona ?? {}) }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { block?: string; personaBlock?: string; setpoints?: LimbicState };
    return {
      restBlock: nonEmpty(json.block) ? json.block : "",
      personaBlock: nonEmpty(json.personaBlock) ? json.personaBlock : "",
      // An older gateway returns no setpoints: the turn's appraisal seeds from neutral.
      setpoints: json.setpoints && typeof json.setpoints === "object" ? json.setpoints : null,
    };
  } catch {
    return null;
  }
}

// Session cache keyed on the persona context, so a user / persona switch re-fetches but
// repeated turns in a session reuse it.
const personalityCache = createPersonalityBlockCache<PersonaContext, PersonalityLayers>();

const layersFor = (secrets: vscode.SecretStorage, persona?: PersonaContext): Promise<PersonalityLayers | null> =>
  personalityCache.get(persona, () => requestPersonalityLayers(secrets, persona));

/**
 * The signed-in user's (or an agent persona's) PERSONALITY-only directive block,
 * cached for the session. Used where personality is static across the conversation
 * (the Brain webview's ambient system context). '' when the profile is neutral or
 * unavailable (a no-op).
 */
export async function fetchPersonalityBlock(secrets: vscode.SecretStorage, persona?: PersonaContext): Promise<string> {
  const layers = await layersFor(secrets, persona);
  return layers ? [layers.restBlock, layers.personaBlock].filter(nonEmpty).join("\n\n") : "";
}

/**
 * THIS turn's affect + personality block: `text` appraised on this machine from the
 * personality's cached setpoints, joined with the cached personality tone. The block
 * makes the built-in agent execute under the same affective layer and tone as the cloud
 * and on-prem agents. Never a per-turn request; '' only at rest with no personality.
 */
export async function turnLimbicBlock(secrets: vscode.SecretStorage, text: string, persona?: PersonaContext): Promise<string> {
  const layers = await layersFor(secrets, persona);
  return [turnAffectBlock(text, layers?.setpoints), layers?.personaBlock ?? ""].filter(nonEmpty).join("\n\n");
}

/** Drop the cached personality (e.g. on sign-out or a personality change). */
export function clearPersonalityBlockCache(): void {
  personalityCache.clear();
}
