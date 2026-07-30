/**
 * The deployed API version, reported by GET /health, the error handler and every
 * diagnostics capture.
 *
 * MUST equal `api/package.json`.`version`. It is a literal rather than a package.json
 * import so the Worker bundle stays free of a JSON resolution step — and because that is
 * exactly the kind of pairing that rots, `npm run check:version` fails the build when the
 * two disagree. They had drifted 44 releases apart (2026.7.115 vs 2026.7.159), which made
 * every diagnostics report state an API version that had not been deployed for weeks and
 * cost a real debugging session chasing a phantom stale deploy.
 */
export const API_VERSION = '2026.7.188';
