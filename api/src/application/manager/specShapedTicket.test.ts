import { describe, it, expect } from 'vitest';
import { isSpecShapedTitle } from './specShapedTicket';

describe('isSpecShapedTitle', () => {
  it.each([
    'PRD: usage-based billing',
    '[Spec] onboarding wizard',
    'Analysis — p95 latency regression',
    'Write the PRD for the billing API',
    'Draft a technical spec for webhook retries',
    'Author the design doc for canvas sharing',
    'Write up an RFC',
    'Prepare the product requirements document',
    'Research competitor pricing pages',
  ])('treats %j as a document deliverable', (title) => expect(isSpecShapedTitle(title)).toBe(true));

  it.each([
    'Implement the billing API per the spec',
    'Write tests for the spec parser',
    'Create the spec loader service',
    'Add a /billing endpoint',
    'Research and implement a caching layer',
    'Fix the analysis dashboard crash',
    '',
  ])('treats %j as code work (or unknown)', (title) => expect(isSpecShapedTitle(title)).toBe(false));

  it('is false for a missing title', () => {
    expect(isSpecShapedTitle(null)).toBe(false);
    expect(isSpecShapedTitle(undefined)).toBe(false);
  });
});
