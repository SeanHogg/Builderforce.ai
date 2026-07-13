/**
 * Test environment setup.
 * Ensures ESM mode and prepares mock sessions or other global fixtures.
 */
import '@builderforce/test-workspace';

// Optional global test helper (not required; kept if needed later)
// import { summarizeCoverage } from '@builderforce/test-workspace';

// ESM safety check
if (Reflect.get(global, '__esModule') === undefined) {
  Object.defineProperty(global, '__esModule', { value: true });
}

// Similarities: no mocks here; these are added per test to isolate failures.
// For now, there are no side-effect globals to configure here.