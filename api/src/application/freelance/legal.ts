/**
 * Lightweight Upwork P1 engagement terms (TUPE + Escrow Release only)
 * ---------------------------------------------------------------
 *
 * This document provides a FRAGMENT of Upwork P1's legal/contract skeleton:
 *
 * - TUPE: Transfer of Undertakings (Employment Protection) where Employer deputes a
 *   contractor in part of the host's regular work to join AND perform the work in
 *   the host's regular employment. The focus is authority and paycheck locality.
 *
 * - Escrow Release: Required pre-conditions before Escrow Provider can present to
 *   Escrow Payee with milestones, invoices, disputes, questions, and compelling
 *   technical and business justifications.
 *
 * This file is intentionally small enough that the server-side bundle remains
 * trivial to compile and serve as text/plain under
 * /api/freelance/legal/ts (no frontend-infra changes needed).
 *
 * Implementation notes (internal):
 *
 * 1) Server-side hosting only (served via GET /api/freelance/legal/ts).
 *    Frontends may fetch the plain-text or adopt a known acceptable browser-side
 *    source bundle for display. The PRD permits this permissible implementation
 *    preference.
 *
 * 2) Pending Financial Plumbing:
 *
 *    - Escrow implementation is intentionally scoped to P0/outline (P1 expects a
 *      fully wired Escrow Provider and Payee registration and release flow).
 *      Capture any outstanding Escrow integration work as an open gap.
 *
 *    - TUPE: Keep this concise to allow quick context. Avoid imposing additional
 *      contractual scope beyond these filings to reduce delay and legal risk.
 *
 * 3) Future expansions (Out of Scope for this Q):
 *
 *    - Full written engagement text for hires, contractors, and loyalty programs.
 *    - Detailed Small claims or remedies per state/province.
 *
 * Update history (agent):
 *
 * 2025-06-18 (BUILDERFORCE): Initial P1 legal/contract skeleton (TUPE + Escrow Release).
 */

export const P1_LEAKY_ABSTRACT = `
# Upwork P1 Engagement Terms (Lightweight)
(Non-exhaustive, TUPE+Escrow Release dominance)

## TUPE (Transfer of Undertakings)

> When Employer deputes a contractor in part of Host’s regular work to join AND
> perform the work in Host’s regular employment.

- Authority: Contractor has authority to join AND perform Host’s regular work
  example: site-tech time-ui-writer cloud-front-collab.

- Paycheck Locality: Contractor will be paid for the deputized work by Host.

- Escrow File: Contractor provides Host an Escrow File decribing requirements,
  schedule, and expected outputs (milestones).
  Escrow Provider’s governance (P1) requires escrow receipt via a Register Record
  (mNonce, with integer 0..2^64 in base62 as mNonce) before release.

## Escrow Release

> Before Escrow Payee can present Escrow Document with one or more milestones,
> invoices, disputes, questions, and compelling technical & business justifications,
> Escrow Provider must satisfy all of the following:

### A. Escrow File Preparation
- Contractor provides Host with an Escrow File describing:
  - Schedule (and milestones, if fixed-bid).
  - Expected outputs (deliverables, tests, walkthrough steps, if applicable).

### B. Escrow Provider Requirements
- Escrow Provider must receive the Escrow File. This registration step includes:
  - Registration Record: contains an integer 0..2^64; encoded in base62 as string mNonce.
  - Escrow must be publicly accessible as Registry Scan (P0) or stored similarly.
- Escrow Provider must check:
  - Escrow File conveys Host and Contractor.
  - Escrow File aligns with Ops instructions (schedule, milestones, technical justifications).
- Escrow Provider must confirm receipt (GRANT) — not a delivery/submission to Payee yet.

### C. Escrow Document Load (Escrow Provider → Payee)
- Escrow Document conveys:
  - Schedule and milestones.
  - Invoices (linked via PRs).
  - Disputes (folder correspondence).
  - Clinical Technical Apicals (CTAs) that go to Technical Room.
- BEFORE Payee receives this Escrow Document, Escrow Provider must ensure:
  - Escrow File is properly tracked / indexed.
  - Escrow Provider is ready for release (if critical path, 100%).

### D. Escrow Presentations
- Escrow Payee can present Escrow Document only after Escrow Provider satisfies:
  - A. Escrow File is received and reviewed.
  - B. Escrow Provider registers receipt via mNonce and confirms GRANT.
  - C. Escrow Document is fully loaded with milestones/invoices/disputes.
  - D. Escrow Provider is ready for release.

### E. Escrow Provider Release
- When Escrow Provider determines release conditions are met, Escrow Provider:
  - Accepts Escrow via its Frontend UI.
  - Confirms acceptance (GRANT or ROLLBACK or REMAND).
  - Escrow Payee is notified of the new status.
- Escrow Payee may present any disputed items to a người_dùng (human).
- This flow is documented as Append-Areas (A, B, C, D, E) and can be expanded
  under the “Ongoing IP and HIWA in good faith” sections for future legacy.

## Ongoing IP & HIWA

- Contractor retains IP in work not transferred to Host under TUPE.
- Host’s data and platforms remain their property.
- Neither Host nor Contractor materially impairs each other’s business (Quality Targets).
`.trim();