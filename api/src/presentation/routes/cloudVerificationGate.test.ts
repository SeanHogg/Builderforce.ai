import { describe, it, expect } from 'vitest';
import { assertsUnrunVerification } from './runtimeRoutes';

/**
 * The serverless cloud executor has no shell, so it can never run a build /
 * type-check / lint / test. `assertsUnrunVerification` flags a finish summary that
 * claims one passed — the loop blocks such a finish once to force an honest
 * restatement. These cases come straight from the reported run (execution #26),
 * where the agent said it was "confident the typecheck will now pass" without ever
 * running it.
 */
describe('assertsUnrunVerification', () => {
  it('flags fabricated "check passed" claims', () => {
    expect(assertsUnrunVerification('I am confident that npm run typecheck will now pass.')).toBe(true);
    expect(assertsUnrunVerification('The type check passes and the build succeeds.')).toBe(true);
    expect(assertsUnrunVerification('All tests are green; lint is clean with no errors.')).toBe(true);
    expect(assertsUnrunVerification('tsc reports no errors now.')).toBe(true);
    expect(assertsUnrunVerification('The TypeScript errors are resolved.')).toBe(true);
  });

  it('does not flag honest summaries that describe the work without claiming a check ran', () => {
    expect(assertsUnrunVerification('Added .ts extensions to the imports and imported `unique`.')).toBe(false);
    expect(assertsUnrunVerification('Implemented the localizations schema changes per the PRD.')).toBe(false);
    expect(assertsUnrunVerification('Wrote the new endpoint and wired it into the router.')).toBe(false);
    expect(assertsUnrunVerification('')).toBe(false);
  });
});
