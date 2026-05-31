/**
 * Test setup for the brain core. jsdom provides localStorage and the DOM; the
 * streaming client is always exercised through mocks, so no network polyfills
 * are needed here. Kept as the single seam for future browser-global stubs.
 */
export {};
