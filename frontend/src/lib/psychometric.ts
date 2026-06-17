/**
 * Psychometric persona types for the Pro persona editor.
 *
 * Mirrors the api catalog (application/persona/psychometricCatalog.ts) and the
 * agent-runtime profile shape (builderforce/psychometrics.ts). The trait vector
 * is keyed by dimension-id strings served by the catalog endpoint — the frontend
 * never hardcodes them.
 */

export interface CatalogDimension {
  id: string;
  name: string;
  low: string;
  high: string;
  description: string;
}

export interface CatalogFramework {
  id: string;
  name: string;
  summary: string;
  dimensions: CatalogDimension[];
}

export interface CatalogQuestion {
  id: string;
  dimension: string;
  text: string;
  reverse?: boolean;
}

export interface EnneagramType {
  type: number;
  name: string;
  motivation: string;
}

export interface PsychometricCatalog {
  entitled: boolean;
  frameworks: CatalogFramework[];
  questions: CatalogQuestion[];
  enneagram: EnneagramType[];
}

/** A persona's psychometric makeup. Persisted on a persona; compiled at run time. */
export interface PsychometricProfile {
  /** dimension-id -> 0..100. Absent dimension = neutral (50). */
  vector: Record<string, number>;
  enneagramType?: number;
  mbti?: string;
  frameworks?: string[];
  source?: 'sliders' | 'questionnaire' | 'imported';
  notes?: string;
}

export const NEUTRAL_SCORE = 50;

/** True when a profile carries at least one non-neutral signal. */
export function profileHasSignal(profile: PsychometricProfile | undefined): boolean {
  if (!profile) return false;
  if (typeof profile.enneagramType === 'number') return true;
  if (profile.mbti) return true;
  return Object.values(profile.vector ?? {}).some((v) => v !== NEUTRAL_SCORE);
}
