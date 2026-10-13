import { describe, expect, it } from 'vitest';
import { authoredWebsiteProblem } from './website';
import {
  REALIZATION_CANVAS_DELIVERY,
  REALIZATION_DELIVERY_KEYS,
  realizationCanvasDelivery,
  realizationWebsiteFromPlan,
} from './realizationDelivery';

describe('REALIZATION_CANVAS_DELIVERY', () => {
  it('covers exactly the eight marketed proof forms', () => {
    expect(REALIZATION_DELIVERY_KEYS).toHaveLength(8);
    expect(Object.keys(REALIZATION_CANVAS_DELIVERY).sort()).toEqual([...REALIZATION_DELIVERY_KEYS].sort());
  });

  it('connects every proof to website.publish / artifact.publish', () => {
    for (const key of REALIZATION_DELIVERY_KEYS) {
      expect(realizationCanvasDelivery(key)).toEqual({
        canvasKind: 'website',
        deliveryAction: 'publish',
        outcomeAction: 'artifact.publish',
      });
    }
  });

  it('rejects a key that is not a proof form', () => {
    expect(realizationCanvasDelivery('not-a-target')).toBeNull();
    expect(realizationCanvasDelivery('')).toBeNull();
  });
});

describe('realizationWebsiteFromPlan', () => {
  it('produces a WYSIWYG site the canvas will accept', () => {
    const website = realizationWebsiteFromPlan({
      title: 'Acme Concierge',
      summary: 'A phone line that answers order questions without a person reading every message.',
      successCriteria: [
        'Five outsiders can say what it does after one take.',
        'Half of questions are answered without a human.',
      ],
      nextStep: 'Open /realize/abc to review and build live.',
    });
    expect(authoredWebsiteProblem(website)).toBeNull();
    expect(website.pages[0]!.sections.some((section) => section.kind === 'hero' && section.heading && section.body && section.cta)).toBe(true);
    expect(website.pages[0]!.sections.length).toBeGreaterThanOrEqual(2);
    expect(website.websiteTheme.style).toBe('editorial');
  });

  it('still authors a complete site when the plan has no criteria yet', () => {
    const website = realizationWebsiteFromPlan({
      title: 'Sketch',
      summary: 'The cheapest proof of the idea.',
      successCriteria: [],
    });
    expect(authoredWebsiteProblem(website)).toBeNull();
  });
});
