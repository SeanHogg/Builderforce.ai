/**
 * The improvement prompt (PRD 33 §5.2 "Prompt"): fixed sections in a fixed order for
 * every audience, the constraints always present, deterministic, and never carrying
 * masked text or anything secret-shaped.
 */
import { describe, expect, it } from 'vitest';
import {
  compileImprovementPrompt,
  IMPROVEMENT_AUDIENCES,
  IMPROVEMENT_PROMPT_SECTIONS,
  scrubPromptText,
  type ImprovementPromptInput,
} from './improvementPrompt';

const INPUT: ImprovementPromptInput = {
  page: { path: '/pricing', url: 'https://shop.example/pricing', siteLabel: 'Shop', goal: 'Start a trial' },
  evidence: [
    { label: 'Visits (30 days)', value: 4210 },
    { label: 'Conversion', value: '2.1%' },
  ],
  changes: [
    {
      selector: 'getByRole("button", { name: "Click here" })',
      label: 'Click here',
      before: 'Click here',
      after: 'Start your free trial',
      reason: 'The button does not say what happens; 38% of visits never press it.',
    },
    {
      selector: 'getByTestId("card-number")',
      label: 'Card number 4242 4242',
      before: 'Jane Doe jane@example.com',
      after: 'Add a lock icon beside the field',
      reason: 'Visitors hesitate on the payment step.',
      masked: true,
    },
  ],
  acceptance: [{ metric: 'conversion_rate', direction: 'up', minVisits: 500 }],
};

const headings = (text: string) => text.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3));

describe('compileImprovementPrompt', () => {
  it.each(IMPROVEMENT_AUDIENCES)('has the five sections in the fixed order for %s', (audience) => {
    const text = compileImprovementPrompt(INPUT, { audience });
    expect(headings(text)).toEqual([...IMPROVEMENT_PROMPT_SECTIONS]);
  });

  it('always carries the constraints', () => {
    for (const audience of IMPROVEMENT_AUDIENCES) {
      const text = compileImprovementPrompt({ ...INPUT, changes: [] }, { audience });
      expect(text).toContain('Keep the brand palette and fonts');
      expect(text).toContain('Do not change prices');
      expect(text).toContain('legal copy');
      expect(text).toContain('Keep the URL structure');
      expect(text).toContain('How Builderforce measures it');
    }
  });

  it('names elements for its audience', () => {
    expect(compileImprovementPrompt(INPUT, { audience: 'coding_agent' })).toContain('1. `getByRole("button", { name: "Click here" })` ("Click here")');
    expect(compileImprovementPrompt(INPUT, { audience: 'site_builder' })).toContain('1. the element "Click here"');
    expect(compileImprovementPrompt(INPUT, { audience: 'composer' })).toContain('Before: Click here');
  });

  it('never includes masked text', () => {
    const text = compileImprovementPrompt(INPUT, { audience: 'composer' });
    expect(text).not.toContain('Jane Doe');
    expect(text).not.toContain('jane@example.com');
    expect(text).not.toContain('4242');
    expect(text).toContain('(masked on this page; not shown)');
    expect(text).toContain('Add a lock icon beside the field');
  });

  it('is deterministic', () => {
    expect(compileImprovementPrompt(INPUT, { audience: 'coding_agent' })).toBe(compileImprovementPrompt(INPUT, { audience: 'coding_agent' }));
  });
});

describe('scrubPromptText', () => {
  it('replaces secret-shaped tokens and emails, and stays on one line', () => {
    const out = scrubPromptText('key sk-abcdefghijklmnop and bfk_12345678abc\nmail ops@shop.example');
    expect(out).toBe('key [redacted] and [redacted] mail [redacted]');
  });
});
