# Creation Canvas release evidence

This directory defines the evidence contract for PRD roadmap R-01 through R-07. It intentionally contains no manufactured production results.

1. Copy `release-evidence.example.json` to a dated, release-specific file outside source control if it contains internal links.
2. From `qa-e2e`, run `pnpm canvas:release` against the deployed release and retain its HTML report and traces.
3. Exercise one disposable large Session by setting `BF_API_URL`, `BF_CANVAS_SESSION_ID`, and authentication, then run `pnpm canvas:capacity > capacity.json`.
4. Attach security, accessibility, web/VSIX, and operations-drill reports.
5. Enter measured ratios as decimal values (`0.9995` means 99.95%).
6. Run `pnpm canvas:audit -- ../docs/design/creation-canvas/evidence/<release>.json`.

The audit exits non-zero until every production threshold and owner sign-off is backed by a dated artifact. Passing repository tests alone must never be recorded as production GA evidence.
