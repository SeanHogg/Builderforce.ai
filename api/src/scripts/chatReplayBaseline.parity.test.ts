/**
 * Pins `api/scripts/chat-replay-baseline.cjs`'s copy of the readiness-claim reading to the guard it copies
 * (`packages/run-guards/src/readinessClaim.ts`). The script runs under plain `node` and run-guards ships TypeScript
 * source only, so the copy cannot be an import; this test is what keeps it from drifting: every pattern must equal
 * the guard's source pattern, and the two `claimsReady` must agree on every fixture.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { claimsReady } from '@builderforce/run-guards';

const require = createRequire(import.meta.url);
const script = require('../../scripts/chat-replay-baseline.cjs') as {
  READY_PATTERNS: readonly RegExp[];
  NEGATION: RegExp;
  claimsReady: (text: string) => boolean;
};

const guardSource = readFileSync(fileURLToPath(new URL('../../../packages/run-guards/src/readinessClaim.ts', import.meta.url)), 'utf8');

/** The regex literals the guard writes between `start` and `end`, as `RegExp#source` reads them. */
function literalsBetween(start: string, end: string): string[] {
  const block = guardSource.slice(guardSource.indexOf(start), guardSource.indexOf(end, guardSource.indexOf(start)));
  return block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('/') && !line.startsWith('//'))
    .map((line) => line.replace(/,$/, '').replace(/^\/(.*)\/$/, '$1'));
}

const FIXTURES = [
  'Now I have everything I need.',
  "I've got all the component contracts.",
  'Now I have the full picture of the registry.',
  'Analysis is over; time to build.',
  'Now I understand the camera registry pattern.',
  'Implementing now.',
  'One final check, then I write the change.',
  "Now I'll write the adapter.",
  'Let me write the changes now.',
  "I don't have everything I need yet.",
  'Once I have the full picture I will edit it.',
  'Do I have everything I need?',
  'Let me make sure the tests pass.',
  'The model said "now I have everything" in the quote.',
  '`now I have everything` is a string',
  "It's not time to build yet.",
  'If the parser is fixed, I will implement it.',
  '',
];

describe('chat-replay-baseline readiness copy', () => {
  it('carries exactly the guard’s READY_PATTERNS', () => {
    const guard = literalsBetween('const READY_PATTERNS', '];');
    expect(guard.length).toBeGreaterThan(0);
    expect(script.READY_PATTERNS.map((p) => p.source)).toEqual(guard);
  });

  it('carries exactly the guard’s NEGATION', () => {
    const line = guardSource.split('\n').map((l) => l.trimEnd()).find((l) => l.startsWith('const NEGATION = /'))!;
    expect(script.NEGATION.source).toBe(line.replace(/^const NEGATION = \//, '').replace(/\/;$/, ''));
  });

  it('agrees with the guard’s claimsReady on every fixture', () => {
    for (const text of FIXTURES) expect(script.claimsReady(text), text).toBe(claimsReady(text));
  });
});
