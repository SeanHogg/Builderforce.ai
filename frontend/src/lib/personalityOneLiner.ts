/**
 * A person's personality as ONE short line - the form a dense list (the @-mention
 * dropdown) can afford. Pure: the caller supplies the catalog and the phrases, so
 * the wording stays in the i18n catalogs and the same profile always reads the same.
 */
import { NEUTRAL_SCORE, profileHasSignal, type PsychometricCatalog, type PsychometricProfile } from '@/lib/psychometric';

const HI = 65;
const LO = 35;

export interface OneLinerPhrases {
  mbti: (value: string) => string;
  enneagram: (type: number) => string;
  /** "High Curiosity" / "Low Agreeableness". */
  trait: (band: 'high' | 'low', name: string) => string;
}

/** MBTI, Enneagram type, then the single strongest trait; '' when there is no signal. */
export function personalityOneLiner(
  profile: PsychometricProfile | undefined,
  catalog: PsychometricCatalog | null,
  phrases: OneLinerPhrases,
): string {
  if (!profile || !profileHasSignal(profile)) return '';
  const parts: string[] = [];
  if (profile.mbti) parts.push(phrases.mbti(profile.mbti));
  if (typeof profile.enneagramType === 'number') parts.push(phrases.enneagram(profile.enneagramType));

  const names = new Map<string, string>();
  for (const fw of catalog?.frameworks ?? []) for (const d of fw.dimensions) names.set(d.id, d.name);
  const strongest = Object.entries(profile.vector ?? {})
    .filter(([, v]) => typeof v === 'number' && (v >= HI || v <= LO))
    .sort((a, b) => Math.abs(b[1] - NEUTRAL_SCORE) - Math.abs(a[1] - NEUTRAL_SCORE))[0];
  if (strongest) parts.push(phrases.trait(strongest[1] >= HI ? 'high' : 'low', names.get(strongest[0]) ?? strongest[0]));
  return parts.join(' · ');
}
