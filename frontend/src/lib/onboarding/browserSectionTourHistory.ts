import type { SectionTourHistory } from './sectionTourPolicy';

const PREFIX = 'builderforce:section-tour';

function storageKey(sectionId: string, audienceId: string): string {
  return `${PREFIX}:${sectionId}:${audienceId}`;
}

export function readSectionTourHistory(sectionId: string, audienceId: string): SectionTourHistory | null {
  try {
    const raw = window.localStorage.getItem(storageKey(sectionId, audienceId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<SectionTourHistory>;
    if (!Number.isInteger(value.version) || !Number.isInteger(value.visits)) return null;
    return value as SectionTourHistory;
  } catch {
    return null;
  }
}

export function writeSectionTourHistory(sectionId: string, audienceId: string, history: SectionTourHistory): void {
  try {
    window.localStorage.setItem(storageKey(sectionId, audienceId), JSON.stringify(history));
  } catch {
    // Onboarding must never make a section unusable when browser storage is blocked.
  }
}
