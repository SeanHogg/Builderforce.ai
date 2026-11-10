/**
 * The voice-clone routes' ONE error → HTTP mapping, shared by the synthesis,
 * commerce, embedding and provenance route modules so none re-decides a status.
 */

import type { Context } from 'hono';
import type { HonoEnv } from '../../env';
import {
  TtsProviderUnavailable,
  VoiceCloneConsentRequired,
  VoiceCloneForbidden,
  VoiceCloneNotFound,
  VoiceCloneReferenceMissing,
  VoiceCloneSynthesisConflict,
} from '../../application/studio/voiceCloneService';
import {
  VoiceProvenanceConflict,
  VoiceProvenanceInvalid,
  VoiceProvenanceUnavailable,
} from '../../application/studio/voiceProvenanceService';

/** Map the service's typed errors to HTTP. Honest 503 when no provider is wired
 *  (the package surfaces it as a fallback reason — never fake audio, PRD §7). */
export function mapVoiceCloneError(c: Context<HonoEnv>, err: unknown) {
  if (err instanceof VoiceCloneNotFound) return c.json({ error: err.message }, 404);
  if (err instanceof VoiceCloneForbidden) return c.json({ error: err.message }, 403);
  if (err instanceof VoiceCloneConsentRequired) return c.json({ error: err.message }, 422);
  if (err instanceof VoiceCloneReferenceMissing) return c.json({ error: err.message }, 422);
  if (err instanceof VoiceCloneSynthesisConflict) return c.json({ error: err.message }, 409);
  if (err instanceof VoiceProvenanceInvalid) return c.json({ error: err.message }, 422);
  if (err instanceof VoiceProvenanceConflict) return c.json({ error: err.message }, 409);
  if (err instanceof VoiceProvenanceUnavailable) {
    return c.json({ error: err.message, code: err.code }, 503);
  }
  if (err instanceof TtsProviderUnavailable) {
    return c.json({ error: err.message, code: 'provider_unavailable' }, 503);
  }
  return c.json({ error: 'Synthesis failed', detail: String((err as Error)?.message ?? err) }, 502);
}
