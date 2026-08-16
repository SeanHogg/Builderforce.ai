/**
 * The CAREER bounded context — one person's working life as this platform models it.
 *
 * ── WHAT THIS DOMAIN OWNS ────────────────────────────────────────────────────────
 * The supply side of work, for an individual: the document they are judged on, the
 * listing they are found through, the comparison between what they have and what a
 * posting wants, the rehearsal before the room, and the money that decides how long they
 * can be selective.
 *
 * It deliberately does NOT own the demand side. Postings, proposals, engagements,
 * timecards and invoices already exist as tenant-scoped entities with their own routes;
 * this domain reads and reasons, and the tool layer replays those routes for anything
 * that writes. That boundary is what keeps a career tool from becoming a second, private
 * copy of the marketplace.
 *
 * ── THE PROPERTY EVERY MODULE HERE SHARES ────────────────────────────────────────
 * Pure. No database, no network, no clock, no Worker env. That is what lets the same
 * functions serve a signed-in tenant, an anonymous visitor on the public canvas, and a
 * unit test — one implementation, three surfaces, no drift. Anything needing a tenant
 * belongs in the tool layer, not here.
 */

export * from './resumeExtract';
export * from './resumeAnalysis';
export * from './jobMatch';
export * from './jobDocument';
export * from './interviewKit';
export * from './compensation';
export * from './career360';
export * from './listing';
export * from './runway';
