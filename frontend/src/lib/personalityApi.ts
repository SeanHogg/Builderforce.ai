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
    const res = await apiRequest<{ block?: string }>('/api/limbic/block', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ psychometric }),
      // Personality is an enhancement, never a hard dependency of the chat — a
      // 4xx/5xx here must degrade to a neutral (personality-less) prompt, not
      // raise the global error toast.
      expectedErrors: [400, 404, 500, 501],
    });
    return typeof res.block === 'string' ? res.block : '';
  } catch {
    return '';
  }
}
