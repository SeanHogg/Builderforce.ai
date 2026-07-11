/**
 * Personality block client — `POST /api/limbic/block`.
 *
 * Compiles the signed-in HUMAN user's psychometric profile into a personality
 * directive block (setpoints + psychometric directives) that shapes the Brain
 * chat's TONE. The shared compiler lives once server-side (the same route the VS
 * Code extension calls), so the web app never bundles it — it just POSTs the
 * profile and receives the rendered block. Best-effort: '' on any error, and ''
 * when the profile is neutral/absent (a no-op).
 */
import { apiRequest } from './apiClient';
import type { PsychometricProfile } from './psychometric';

/**
 * Fetch the personality directive block for a psychometric profile. The result is
 * memoised per-profile so co-mounted / re-mounted callers within a render tree
 * don't re-hit the gateway for the same profile. Returns '' when there is no
 * profile to compile.
 */
export async function fetchPersonalityBlock(
  psychometric: PsychometricProfile | null | undefined,
): Promise<string> {
  if (!psychometric) return '';
  try {
    const res = await apiRequest<{ block?: string; personaBlock?: string }>('/api/limbic/block', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ psychometric }),
      // Personality is an enhancement, never a hard dependency of the chat — a
      // 4xx/5xx here must degrade to a neutral (personality-less) prompt, not
      // raise the global error toast.
      expectedErrors: [400, 404, 500, 501],
    });
    // The static personality tone lives in `personaBlock`; `block` is the dynamic
    // affect (near-empty for this text-less request). Join both non-empty layers.
    return [res.block, res.personaBlock]
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      .join('\n\n');
  } catch {
    return '';
  }
}

/**
 * Fetch the PER-TURN dynamic affect block for a psychometric profile appraised
 * against this turn's message text — the web half of per-turn limbic parity with
 * the VS Code webview. Unlike {@link fetchPersonalityBlock} (static tone), this
 * returns only the DYNAMIC `block`, which the server derives by appraising `text`
 * seeded from the user's `psychometric`. Meant to back a Brain host's
 * `augmentSystemPrompt(userText)` seam — one call per user message.
 *
 * Best-effort and no-op-safe: returns '' when there is no profile, no text, or on
 * any error, so the turn always proceeds unaffected. The STATIC personality block
 * is injected separately (via `extraSystem`) and is unaffected by this call.
 */
export async function fetchLimbicBlock(
  psychometric: PsychometricProfile | null | undefined,
  text: string,
): Promise<string> {
  if (!psychometric || !text.trim()) return '';
  try {
    const res = await apiRequest<{ block?: string; personaBlock?: string }>('/api/limbic/block', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Pass BOTH so the affect is seeded from personality AND appraises this
      // turn's text; we consume only the dynamic `block` (personaBlock is the
      // static tone already injected via extraSystem — don't double it).
      body: JSON.stringify({ text, psychometric }),
      expectedErrors: [400, 404, 500, 501],
    });
    return typeof res.block === 'string' && res.block.trim().length > 0 ? res.block : '';
  } catch {
    return '';
  }
}
