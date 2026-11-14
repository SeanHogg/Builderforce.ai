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
import { turnAffectBlock } from "@seanhogg/builderforce-brain-embedded";
import { createPersonalityBlockCache } from "./personalityBlockCache";
import { currentCapabilityInputs } from "./capabilityContext";
import { networkDenied } from "./capabilityStates";
const nonEmpty = (s) => typeof s === "string" && s.trim().length > 0;
/**
 * The ONE transport to the personality endpoint. Distinguishes a FAILURE (`null`:
 * signed out, offline, denied by the platform policy, a non-2xx, a bad body) from an
 * answer (a neutral profile is an answer with empty layers). Only an answer may be
 * cached — a failure cached for the session left personality off until the editor
 * restarted. Signed out it returns before any request.
 */
const PERSONALITY_TIMEOUT_MS = 10_000;
async function requestPersonalityLayers(secrets, persona) {
    // PRD 41 A5: platform denied ⇒ nothing is attempted; the turn's affect is appraised locally and the
    // remembered personality (the cache) still answers. Not cached as a failure.
    if (networkDenied(currentCapabilityInputs()))
        return null;
    try {
        // `/api/*` is JWT-only: the session transport exchanges the editor key for the
        // selected workspace's token (a raw key 401s there). Signed out it resolves undefined.
        // Lazy: the session module needs a full vscode host at import time.
        const { fetchAuthed } = await import("./bfApi/transport");
        const res = await fetchAuthed(secrets, "/api/limbic/block", {
            asTenant: "current",
            method: "POST",
            body: JSON.stringify({ text: "", ...(persona ?? {}) }),
            // Unbounded, a gateway that never answers held every caller (the panel's init) for undici's 300 s.
            signal: AbortSignal.timeout(PERSONALITY_TIMEOUT_MS),
        });
        if (!res?.ok)
            return null;
        const json = (await res.json());
        return {
            restBlock: nonEmpty(json.block) ? json.block : "",
            personaBlock: nonEmpty(json.personaBlock) ? json.personaBlock : "",
            // An older gateway returns no setpoints: the turn's appraisal seeds from neutral.
            setpoints: json.setpoints && typeof json.setpoints === "object" ? json.setpoints : null,
        };
    }
    catch {
        return null;
    }
}
// Session cache keyed on the persona context, so a user / persona switch re-fetches but
// repeated turns in a session reuse it.
const personalityCache = createPersonalityBlockCache();
const layersFor = (secrets, persona) => personalityCache.get(persona, () => requestPersonalityLayers(secrets, persona));
/**
 * The signed-in user's (or an agent persona's) PERSONALITY-only directive block,
 * cached for the session. Used where personality is static across the conversation
 * (the Brain webview's ambient system context). '' when the profile is neutral or
 * unavailable (a no-op).
 */
export async function fetchPersonalityBlock(secrets, persona) {
    const layers = await layersFor(secrets, persona);
    return layers ? [layers.restBlock, layers.personaBlock].filter(nonEmpty).join("\n\n") : "";
}
/**
 * THIS turn's affect + personality block: `text` appraised on this machine from the
 * personality's cached setpoints, joined with the cached personality tone. The block
 * makes the built-in agent execute under the same affective layer and tone as the cloud
 * and on-prem agents. Never a per-turn request; '' only at rest with no personality.
 */
export async function turnLimbicBlock(secrets, text, persona) {
    const layers = await layersFor(secrets, persona);
    return [turnAffectBlock(text, layers?.setpoints), layers?.personaBlock ?? ""].filter(nonEmpty).join("\n\n");
}
/** Drop the cached personality (e.g. on sign-out or a personality change). */
export function clearPersonalityBlockCache() {
    personalityCache.clear();
}
//# sourceMappingURL=personalityLimbic.js.map