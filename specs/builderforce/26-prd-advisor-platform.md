# PRD 26 — Advisor Platform (epic #2522)

**Status:** Product contract for epic **#2522** · rewritten 2026-09-16 on ticket **#2604**
**Owner:** platform (Talent listing + meetings + board-sync)
**Board:** epic **#2522** · Spec path (do not change): `specs/builderforce/26-prd-advisor-platform.md`
**Companion (compose-only):** [`26-implementation-notes-advisor-platform.md`](./26-implementation-notes-advisor-platform.md) — build detail only; **this file wins** if the two diverge
**Not this epic:** marketplace composition A0–A5, `/marketplace?family=talent` Book bind, restricted Brain thread — those belong to epic **#2545** (see §6)

This revision **replaces** the 2026-09-16 research artifact that specified epic **#2545** (SCORE-checklist marketplace composition) as PRD 26. Git history retains that body. Do not implement it to close **#2522**.

---

## 0. Composition contract (read this first)

1. **Single product source.** Children of **#2522** use **this file** as the only product contract for this epic. Implementation notes may add wiring, filters, and module pointers. They MUST NOT introduce product behaviour that is absent here. If notes and this PRD disagree, **edit the notes**.
2. **Direction of reconcile.** This file was rewritten to match epic **#2522**. Do **not** rewrite the notes so that #2522 would ship the old #2545 product.
3. **Sufficiency.** A child that implements only this PRD cannot be required to ship A2–A5, `/marketplace?family=talent` Book bind, or a restricted Brain thread in order to close #2522.
4. **Behaviour, not unshipped filenames-as-done.** This PRD specifies *what* must be true. Naming the real meeting/minutes modules children will edit is sibling **#2606**. Presenting unshipped HTTP routes, `meetingRoutes.ts` (if absent on `main`), or `BookAdvisorPanel` as already decided/done is sibling **#2605**. Do not make that error here.
5. **Epic ticket text is not a second PRD.** #2522’s board description may still mention marketplace Book / SCORE-class advising. After this rewrite, **this file** is source of truth. A later coordinator may re-align epic title/description; this ticket does not.

---

## 1. Goal

Founders and operators can find Advisors on the talent catalog, hold an **advisory** meeting as a first-class meeting kind, and get structured minutes onto the board **without** a standup ritual and **without** a second scrape pipeline.

SCORE.org remains a **capability checklist**, not a product to clone. Builderforce does not add a fifth marketplace family, an `/advisors` destination, or `advisor` as a listing kind.

---

## 2. Who

| Role | Need |
|---|---|
| **Founder / operator** | Hire or meet Advisors; keep a durable record of advisory conversations on the board |
| **Advisor** | Talent listed under `category=advisors`; run advisory meetings; notes land without a separate standup |
| **Meeting Notes agent** | Input = the advisory meeting; output = structured minutes suitable for the shared board pull |
| **Board-sync** | One generalised pull path for standup **and** advisory minutes |
| **Downstream implementer on #2522** | Must not also build marketplace family Book bind, academy, workshops, packs, or restricted Brain from this PRD |

---

## 3. In scope for epic #2522

1. Talent listing / filter for Advisors (`category=advisors`).
2. First-class meeting kind `advisory` (create, list, complete).
3. Meeting Notes agent scoped to advisory meetings.
4. Minutes → board via **one** generalised pull of today’s standup-minutes pull (standup and advisory share the path).

**Not in scope for #2522** (owned by **#2545**, not “later in 26”): A2–A5 workshops / academy / packs; `/marketplace?family=talent` Book bind; a restricted Brain thread for advisor conversations; advisory meetings existing *only* as a side effect of a Book bind.

---

## 4. Product

### 4.1 Advisors talent filter

Users can filter talent to Advisors and act on that list.

- Advisors is a talent **category / listing filter** (`category=advisors` on the existing talent catalog). It is **not** a marketplace family, **not** a listing kind, **not** a second user type, and **not** a new `/advisors` route.
- Do **not** add `advisor` (or `advisors`) to `MARKETPLACE_LISTING_KINDS`.
- Do **not** invent `/advisors` as a marketplace family route as part of this epic.
- Do **not** specify this filter as `/marketplace?family=talent` Book bind (that bind is **#2545**).
- In-scope action on the list is the **advisory-meeting flow** (schedule / join / notes). Existing talent CTAs (e.g. Hire when the person is also available-for-hire) may remain; they are not this epic’s product.
- Advisor profile fields that make the filter useful (expertise, industries, languages, methods, stages, session length, price including 0, location, confidentiality *default on the listing*) are compatible with child **#2527**. They do not create a new user type and do not add `advisory` to `PEOPLE_OBJECT_KINDS`.

### 4.2 Meeting kind `advisory`

Creating, listing, and completing advisory meetings uses kind `advisory`.

- **Standup** remains a distinct kind. Advisory is not a standup with a different label.
- Unknown kinds continue to coerce to `adhoc` (existing behaviour).
- Register `advisory` in the meeting-kind list used to create/list/complete meetings. Child **#2536** owns that registration. Do **not** add `advisory` to `TEAM_CEREMONY_KINDS` (`standup` / `planning` / `retrospective` / `review`). Advisory must **not** default-link team chat.
- There is **no** requirement that an advisory meeting exists only as a side effect of a Book bind.
- Frontend `ScheduleMeetingPanel` (or equivalent) duplicating the KINDS list is a **follow-on**, not shipped by this rewrite and not claimed as already done.

### 4.3 Origins of an advisory meeting

An `advisory` meeting is first-class. Any of the following may create one; **none** is the only origin:

| Origin | Status on this epic |
|---|---|
| Authenticated schedule / create with kind `advisory` | Required (R4) |
| Public ATS-style `/book/[token]` (or slug-scoped token) that writes kind `advisory`, advisor as organizer, visitor as attendee | **Allowed** — child **#2532**. Compatible. Must **not** be specified as `/marketplace?family=talent` Book bind. Must **not** be the only origin |
| A0 storefront Book CTA on `/marketplace?family=talent` binding Talent listing ↔ `booking_services` | **Not this epic** — **#2545** |

Visitor join-by-token, if shipped by **#2532**, must not punch a hole in auth for the whole meetings surface.

### 4.4 Meeting Notes agent

An agent produces minutes for `advisory` meetings.

- **Input:** the advisory meeting (attendees, time, whatever transcript/notes the workspace already captures for meetings).
- **Output:** structured minutes suitable for the generalised board pull. Use the **same three-section Markdown contract** already used by standup minutes so parsers do not fork.
- The agent is in-scope for **#2522**. Defining it does **not** require publishing it as a marketplace `agent` listing.
- Publishing Meeting Notes as a marketplace `agent` listing is **optional P1** (child **#2538** may still ship it). It is **not** deferred to **#2545** by this contract, and it is **not** required to close #2522.

### 4.5 Minutes → board (one pull path)

Board sync uses a **generalised** pull of today’s standup-minutes pull (renamed or extended) that accepts **standup and advisory** minutes.

- Advisory minutes appear on the board **without** a standup meeting and **without** a second scrape pipeline.
- Standup minutes continue to work on the **same** path.
- Do **not** replace board pull with a new minutes store or a second act beside the generalised pull.
- Idempotent placement of open action items (by title) is compatible with child **#2538** P1; it is not a second pipeline.
- Propose-don’t-silently-book a follow-up slot, and guest-workspace claim, are **#2538** P1 / children **#2542** / **#2543** — not P0 of this PRD.

---

## 5. Functional requirements

### FR-1 — Single product on this file (R0, R1, R7, R8)

- **FR-1.1** #2522 Spec remains this path.
- **FR-1.2** Notes compose; they do not become a second PRD.
- **FR-1.3** This file is sufficient for children to implement #2522 without reading #2545’s product as in-scope.

### FR-2 — Advisors filter (R3)

- **FR-2.1** Talent catalog accepts `category=advisors` and returns Advisor listings.
- **FR-2.2** Users can act on that list via the advisory-meeting flow.
- **FR-2.3** No `advisor` listing kind; no `/advisors` family route; not `/marketplace?family=talent` Book bind.

### FR-3 — Kind `advisory` (R4)

- **FR-3.1** Create / list / complete with kind `advisory`.
- **FR-3.2** Standup stays distinct; unknown kinds still coerce to `adhoc`.
- **FR-3.3** `advisory` is not a team-ceremony kind and does not default-link team chat.
- **FR-3.4** Advisory meetings are not Book-only.

### FR-4 — Meeting Notes (R5)

- **FR-4.1** An agent produces structured minutes from an advisory meeting.
- **FR-4.2** Minutes use the standup three-section Markdown contract (no parser fork).
- **FR-4.3** Marketplace listing of that agent is optional P1, not P0.

### FR-5 — One pull path (R6)

- **FR-5.1** One generalised pull accepts standup and advisory minutes.
- **FR-5.2** Advisory minutes reach the board without a standup meeting.
- **FR-5.3** Standup minutes still work. No parallel advisory-only board pipeline.

### FR-6 — Explicit split (R2)

- **FR-6.1** A2–A5, `/marketplace?family=talent` Book bind, and restricted Brain are **#2545**, worded as owned by **#2545**, not as later work in 26.

---

## 6. Explicit split — epic #2545 owns the rest

The following were previously documented in this file as PRD 26. They are **not** #2522 delivery. They are **not** “later in 26”. They belong to epic **#2545**.

| Item | What it is | Owner |
|---|---|---|
| **A0 · Bind** | Talent `person` listing ↔ `booking_services`; Book CTA on `/marketplace?family=talent`. Recommended bind: `booking_hosts.host_ref` = talent userId (composition notes / **#2593**). Do **not** add `advisor` to `MARKETPLACE_LISTING_KINDS`. | **#2545** |
| **A1 · Session** | Reservation → meeting + calendar + **restricted Brain thread** (confidentiality default `restricted`; not in `aiContext` unless the founder invites) | **#2545** |
| **A2 · Group** | Workshops as `one_to_many` (capacity counted; no `/webinars` page) | **#2545** |
| **A3 · Academy** | Stage-tagged `course` listings + LMS enrolment | **#2545** |
| **A4 · Toolkit** | One `pack` per `BUSINESS_STAGES` | **#2545** |
| **A5 · Engagement** | Continue-with-this-advisor (prefer a relation, not a new table) | **#2545** |

**#2545**’s own Spec field may still point at this path. After this revision, **#2545 must not treat this file as its product contract.** Its board description (A0–A5 acceptance) remains the checklist until #2545 has its own spec. **This ticket does not create that spec** and does not rewrite #2545 beyond this pointer.

Kill conditions that still apply to **#2545** (not to #2522): a reviewer can kill #2545 if it requires a `/advisors` page, a new listing family, or a volunteer/chapter table. Those constraints remain good hygiene for #2522 as well (see §9) but they are not #2522’s acceptance.

---

## 7. Children (not re-parented by #2604)

Existing children stay under **#2522**. After this rewrite they follow **this** PRD. A later coordinator may re-align titles/section cites (`§4.2` / `§8` / `§9` on the old research artifact are void). Do not invent a third product.

| Child | Follows this PRD |
|---|---|
| **#2527** | FR-2 Advisors filter / listing mode on talent (not a second user type) |
| **#2532** | FR-3 kind `advisory` + allowed public token-book origin (not family=talent Book bind) |
| **#2536** | Register `advisory` in meeting KINDS only; not `TEAM_CEREMONY_KINDS` |
| **#2538** | FR-4 agent + FR-5 generalised pull; marketplace `agent` listing optional P1 |

Siblings **#2605** (unshipped routes as done) and **#2606** (real module names) stay out of this rewrite.

---

## 8. Acceptance (epic #2522)

A reviewer closes **#2522** against this file when all of the following are true:

1. Talent can be filtered to Advisors (`category=advisors`) and the user can start the advisory-meeting flow from that list. Advisors is not a new listing family and not `/advisors`.
2. Meetings can be created, listed, and completed with kind `advisory`. Standup still exists as its own kind. Advisory does not default-link team chat.
3. A Meeting Notes agent produces structured minutes from an advisory meeting using the standup three-section Markdown contract.
4. Those minutes reach the board through the **same** generalised pull path as standup minutes. Standup minutes still work. There is no parallel advisory-only board pipeline.
5. Closing #2522 did **not** require shipping A2–A5, `/marketplace?family=talent` Book bind, or a restricted Brain thread.
6. Implementation notes, if present, do not specify product behaviour absent from this file.

A reviewer **rejects** a #2522 child that treats this PRD as a licence to build workshops, academy, packs, family=talent Book bind, or restricted Brain.

---

## 9. Out of scope / non-goals (R9)

- Building or restating epic **#2545** in this file beyond the pointer in §6.
- New meeting kinds other than `advisory`.
- Changing standup except for sharing the pull path.
- Pipeline, billing, or talent-category work unrelated to Advisors.
- Rewriting implementation notes so that #2522 would ship marketplace / A0–A5 / restricted Brain.
- Absorbing sibling gaps **#2605** and **#2606**.
- A volunteer/SBA/chapter network, U.S.-only eligibility, SCORE branding, in-person venue logistics.
- Adding `advisor` to `MARKETPLACE_LISTING_KINDS` or a sixth canvas launch mode.
- A dedicated Advisor destination or rail item parallel to Marketplace.

---

## 10. Follow-ons (not this rewrite)

- Mirror `advisory` in the frontend meeting-kind list (`ScheduleMeetingPanel` or equivalent) if it duplicates server KINDS.
- README index blurb for doc 26 (still SCORE-class / marketplace-flavoured) should match this file after merge; **#2604** does not edit README.
- **#2545** needs its own spec path so its Spec field does not keep pointing at a #2522 PRD.
- Notes alignment (**R7**) when `26-implementation-notes-advisor-platform.md` is on the tree (**#2593** / do not merge PR **#829** as-is).
- Stage chips on `?category=advisors` (`freelancer_profiles.stages` tokens `start|grow|exit`, query key `stage`) are **#2586** / **#2637**, not this rewrite.

---

## 11. Claim-to-proof

Public copy may say founders can **find Advisors, meet them, and land notes on the board**. It may not say we are a SCORE alternative, an SBA partner, that mentoring is free unless a live listing is priced 0, or that Marketplace family Book / Academy / packs shipped as this epic.
