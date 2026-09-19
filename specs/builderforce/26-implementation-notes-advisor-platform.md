# PRD 26 — Advisor Platform implementation notes

**Epic:** #2522  
**Spec:** `specs/builderforce/26-prd-advisor-platform.md`  
**Owner:** developer on the epic  
**Date:** 2026-09-16  
**Principle:** Compose existing primitives. Do not clone SCORE.

This file is the epic composition contract. Downstream P0/P1 agents must read **this path on `main`**, not chat or project memory. Production code for the kill condition ships on the child tickets, not on epic #2522.

## Cite this (do not re-derive)

| Rule | Contract |
| --- | --- |
| Talent filter | `category=advisors` is a **talent-catalog filter** over opted-in talent. Not a separate advisor entity, not a booking product type, not `advisor` in `MARKETPLACE_LISTING_KINDS`, not `advisory` in `PEOPLE_OBJECT_KINDS`, not `/advisors`. |
| A0 bind | `booking_hosts.host_ref = talent userId`. No display-name, email, or parallel advisor-id mapping. Do not store `booking_service_id` on `freelancer_profiles`. |
| P0/P1 ship | Behavior ships on **#2527**, **#2532**, and **#2538**. Those issues consume this contract; they do not redefine it. |
| Epic boundary | Epic **#2522** owns composition and this notes spec. It does not absorb talent, booking, or minutes implementation source. |

#2588 (environment bind for the #2527 checkout) is out of scope for this file and for epic #2522.

Product intent lives in [26-prd-advisor-platform.md](./26-prd-advisor-platform.md). Bind and ship-vehicle rules live here.

---

## 1. What this epic is (and is not)

BuilderForce already has talent profiles, ATS public book-by-token, WebRTC meetings (`runAgentTurn` + `summarizeMeeting`), `parseMeetingMinutes`, `pullStandupMinutesAct`, and marketplace listings (agent / skill / course / playbook / template).

The product work is **wiring**: an advisor is opted-in talent; discovery is a marketplace category filter; booking is the existing public token; the session is `kind=advisory`; notes and tasks reuse the minutes pipeline.

It is **not** a mentoring org, a new video product, a new notes editor, a CMS/LMS, a payout rail, or a SCORE/SBA affiliate.

**Kill condition (P0 + P1):** a logged-out visitor opens `/marketplace?category=advisors`, books via public Book, joins by token, the advisor joins on existing WebRTC, the meeting ends, and without any staff click the visitor sees (a) at least one board task from the minutes and (b) at least one proposed follow-up from availability.

---

## 2. Child ownership (do not invert, do not dump onto #2522)

| Ticket | Band | Owns | Branch |
| --- | --- | --- | --- |
| #2523 | Research | Spec + SCORE→primitive map | done (`1000f451f` on main) |
| #2527 | P0 | Advisor toggle + fields; `/marketplace?category=advisors` | `builderforce/task-2527` |
| #2532 | P0 | Public book-by-token; `kind=advisory`; visitor join-by-token | (none yet) |
| #2538 | P0/P1 | Meeting Notes marketplace agent; generalise standup-minutes act; follow-up proposal | (none yet) |
| P2 follow-up | P2 | Expertise / language / method / stage filters; visitor chat; Resources tab | file after kill condition |
| P3 follow-up | P3 | Pro-bono badge; location; Start / Grow / Exit as listing filters | file after P2 |

P2 and P3 must not block P0/P1.

---

## 3. Composition map

| Capability | Primitive to reuse | Forbidden substitute |
| --- | --- | --- |
| Advisor identity | Talent / freelancer profile + opt-in flag (default off) | New user type; `advisory` in `PEOPLE_OBJECT_KINDS` |
| Discovery | Marketplace listing chrome + `?category=advisors` filter over opted-in talent | `/advisors` route; `advisor` in `MARKETPLACE_LISTING_KINDS` |
| Book | ATS `/book/{token}`; `booking_hosts.host_ref = talent userId` | New booking product; `freelancer_profiles.booking_service_id` bind (cross-tenant leak) |
| Session | Meetings `kind=advisory`; existing WebRTC | New video stack |
| Join | Token join (copy interviewScheduling token→tenant) | Hole in `authMiddleware` for the whole meetings router |
| Notes | `runAgentTurn` + `summarizeMeeting` + `parseMeetingMinutes` | New notes schema or editor |
| Action items | Generalised `pullStandupMinutesAct` (parameterize by meeting kind / source) | A second minutes pipeline |
| Follow-up | Same availability solver; **propose**, do not silently book | Auto-booked next session |
| Resources (P2) | That talent's existing marketplace listings only | New CMS / LMS / content type |
| Volunteer (P3) | Badge when session price is 0 / unpaid flag | New payout rail |

`SEEKING_TYPES` already includes `advisors` / `mentorship`. `BUSINESS_STAGES` already exists. Stage fit is stored in P0 so P3 can filter without a migration later.

---

## 4. A0 bind (decided — do not re-derive)

- `booking_hosts.host_ref` **= talent `userId`**.
- Do **not** store `booking_service_id` on `freelancer_profiles` (cross-tenant leak).
- Public `GET /api/freelancers/:id/booking-services` (web) and `POST /api/freelancers/:id/reservations` (tenant JWT + `authMiddleware`) call `listServicesForHost` / `reserveForHost`.
- Those go through `acrossTenants(bookingServices, 'public_catalogue', host_ref)`.
- `reserveForHost` writes via `reserve(..., hosted.tenantId)` so overlap **409** is in the advisor's tenant.
- `practiceOps` stays authed.
- TalentDetailClient **Book** is shown for `!isOwner && bound`, **not** gated on `canHire`. Hire / Message / Shortlist stay `canHire`.
- `reserveTalentSession` auth tenant, `expectedErrors: [409]`.
- Guest post-meeting board is #2538 (prefer guest project + claim link if the visitor has no tenant).

Concurrent dirt: `BookAdvisorPanel` and `talent.book*` i18n keys already exist in an uncommitted tree. **Do not clobber.** Wire to them.

---

## 5. P0 — #2527 Advisor profiles + marketplace category

- Opt-in toggle on the talent listing. Off by default. Non-advisor talent must not appear in `category=advisors`.
- When on, require: headline, expertise tags, method (1:1 / office hours / video / phone / email / in-person as the child ticket lists), stage fit (`start` / `grow` / `exit`), languages, short bio, availability source already used by ATS.
- Price `0` = volunteer. Store it now; the badge is P3.
- Confidentiality default from existing `CONFIDENTIALITY_LEVELS`.
- `/marketplace?category=advisors` uses the **same marketplace listing chrome** as other categories. Cards link to the public talent profile. Primary CTA is Book (Hire secondary if also available-for-hire).
- Authenticated advisor setup is a destination / Canvas object (PRD 21), not a new chrome-ful app.
- Five locales, both themes.
- Do **not** add `advisory` to `PEOPLE_OBJECT_KINDS`.
- Do **not** add `advisor` to `MARKETPLACE_LISTING_KINDS`.
- Do **not** add `/advisors`.

Likely touch (children confirm against tree; do not invent files that are not there):

- `packages/creation-canvas-contract/src/startupListing.ts` — seeking / stages (read, do not duplicate)
- `packages/creation-canvas-contract/src/people.ts` — confidentiality; do not extend kinds
- `packages/creation-canvas-contract/src/marketplaceListings.ts` — category filter, not a new kind
- Frontend talent profile + marketplace category query
- Freelancer / talent persistence for the advisor flag + fields (existing profile row / JSON, not a new table)

---

## 6. P0 — #2532 Public visitor booking + advisory meeting join

- Generalise ATS `/book/[token]` so a logged-out visitor can book from the public advisor profile.
- Public availability read: tokenised / slug-scoped; return **future free slots only** (never raw windows, never other attendees).
- Visitor name + email → meeting `kind=advisory`, advisor organizer, visitor attendee.
- Chrome-less confirm + join link (`NO_CHROME_PREFIXES`).
- Add `advisory` to `KINDS` in `meetingRoutes.ts`.
- Visitor join-by-token: copy the **interviewScheduling** token→tenant pattern. Do **not** open `authMiddleware` for the whole meetings router.
- Do **not** default team-ceremony chat on for advisory.
- Mirror to the advisor's connected calendar when present.
- Booking creates the advisory meeting **and** the join token. No staff provisioning of rooms or accounts.

---

## 7. P0/P1 — #2538 Meeting Notes + minutes → tasks + follow-up

### P0 notes

- Publish **Meeting Notes** as a marketplace `agent` listing wrapping `runAgentTurn` (silent notetaker persona for `kind=advisory`). Default-on for dogfood advisors.
- On meeting end, `summarizeMeeting` already runs. Keep the **three-section Markdown** contract (Summary / Decisions / Action items) so `parseMeetingMinutes` does not fork.
- Ending the call is the only advisor action required. No staff, no extra "write notes" click.

### P1 action items

- Generalise `pullStandupMinutesAct` so it is parameterized by meeting kind / source. **One pipeline.**
- On end, parsed open action items are placed as board tasks on the visitor's resulting workspace/board (the minimum workspace/board the booking already implies).
- Placement is **idempotent by title**.
- Canvas task objects + API tasks when the visitor has or creates a project.
- Fixture: at least one action item from an advisory transcript lands on the board automatically.

### P1 follow-up

- From minutes + advisor availability, **propose** one follow-up slot. Do not silently book it.
- Proposal is visible to the visitor after the call ends, bookable without staff.
- Email both parties.
- Guest with no tenant: prefer guest project + claim link (open question on #2538 — decide there, do not invent a parallel task system).

### Tests #2538 must land

- Public book → meeting row with `kind=advisory`.
- Parser still accepts the three-section Markdown.
- Placing items is idempotent.
- Visitor token cannot list other advisors' meetings.

---

## 8. P2 / P3 (after kill condition)

**P2**

- Filters on `category=advisors` only: expertise, language, method, stage. Must not break other marketplace categories.
- Visitor chat on the public advisor profile using the existing chat primitive. No new messenger.
- Resources tab: that advisor's existing listings only (agent / skill / course / playbook / template). Empty state allowed.

**P3**

- Volunteer / pro-bono badge when sessions are unpaid; hidden otherwise.
- Location on profile and as an optional filter.
- Start / Grow / Exit as first-class listing filters matching the P0 stage fields.

---

## 9. Cross-cutting

- No SCORE name, logo, or SBA affiliation in UI or copy.
- No new payout rail. Paid vs pro-bono is badge / availability only.
- No new video, notes, CMS, or LMS surfaces.
- Logged-out discovery and booking must work end-to-end.

---

## 10. What this change contains

This notes file (the epic composition contract) plus an optional one-line pointer from [26-prd-advisor-platform.md](./26-prd-advisor-platform.md). Epic working notes `specs/tasks/task-2522.md` stay on epic #2522 / PR #829 — they are not part of this change. No talent, booking, or minutes implementation source, and no #2588 env-bind.

Implementers pick up at #2527 → #2532 → #2538 in that order.