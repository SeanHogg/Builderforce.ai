import { describe, expect, it } from 'vitest';
import { registerSectionVisit, resolveSectionTour } from './sectionTourPolicy';

describe('section tour eligibility', () => {
  it('offers an unresolved tour after the configured visit threshold', () => {
    const first = registerSectionVisit(null,{ version:2,minimumVisits:2 });
    expect(first.shouldOffer).toBe(false);
    expect(registerSectionVisit(first.history,{ version:2,minimumVisits:2 }).shouldOffer).toBe(true);
  });

  it('does not nag after dismissal or completion', () => {
    const visited = registerSectionVisit(null,{ version:1 }).history;
    expect(registerSectionVisit(resolveSectionTour(visited,'dismissed'),{ version:1 }).shouldOffer).toBe(false);
    expect(registerSectionVisit(resolveSectionTour(visited,'completed'),{ version:1 }).shouldOffer).toBe(false);
  });

  it('offers a newer tour version independently', () => {
    const old = resolveSectionTour(registerSectionVisit(null,{ version:1 }).history,'completed');
    expect(registerSectionVisit(old,{ version:2 }).shouldOffer).toBe(true);
  });
});
