export type SectionTourOutcome = 'dismissed' | 'completed';

export interface SectionTourHistory {
  version: number;
  visits: number;
  outcome?: SectionTourOutcome;
  lastStep?: number;
}

export interface SectionTourEligibility {
  version: number;
  minimumVisits?: number;
}

export function freshSectionTourHistory(version: number): SectionTourHistory {
  return { version, visits: 0 };
}

export function registerSectionVisit(
  history: SectionTourHistory | null,
  eligibility: SectionTourEligibility,
): { history: SectionTourHistory; shouldOffer: boolean } {
  const current = history?.version === eligibility.version
    ? history
    : freshSectionTourHistory(eligibility.version);
  const next = { ...current, visits: current.visits + 1 };
  return {
    history: next,
    shouldOffer: !next.outcome && next.visits >= (eligibility.minimumVisits ?? 1),
  };
}

export function resolveSectionTour(
  history: SectionTourHistory,
  outcome: SectionTourOutcome,
  lastStep?: number,
): SectionTourHistory {
  return { ...history, outcome, lastStep };
}
