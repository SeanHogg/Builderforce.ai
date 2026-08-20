/**
 * The PEOPLE bounded context — the employed workforce, as this platform reads it.
 *
 * ── WHAT IT OWNS ─────────────────────────────────────────────────────────────
 * The roster and the four questions a roster can honestly answer: how the org is
 * SHAPED (`orgReview`), what filling every open requisition would COST
 * (`headcountPlan`), where a review cycle STANDS (`performanceReview`), and which
 * teams carry structural RISK (`teamHealth`) — plus the sync that puts the roster
 * in `people_employees` in the first place.
 *
 * Distinct from `career/`, which is one PERSON's working life from their own side
 * — the résumé, the listing, the offer. That domain serves the individual; this
 * one serves the employer, and the two never share a row.
 *
 * ── THE PURE HALF IS WHAT THIS BARREL EXPORTS ────────────────────────────────
 * Everything below takes rows and returns rows: no database, no network, no clock
 * beyond a `now` the caller passes. `hrmsPort.ts`, `hrmsSync.ts` and
 * `hrAnalytics.ts` are deliberately NOT re-exported here, for the same reason
 * `career/index.ts` withholds `references.ts` — they need a `Db` and an `Env`, and
 * a barrel that pulls them in would make every importer of a pure function drag
 * the connector runtime along with it.
 */

export * from './roster';
export * from './orgReview';
export * from './headcountPlan';
export * from './performanceReview';
export * from './teamHealth';
export * from './rosterReconciliation';
