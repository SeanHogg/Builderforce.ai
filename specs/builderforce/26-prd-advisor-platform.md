# PRD 26 — Advisor platform as marketplace composition (not a SCORE clone)

**Status:** Proposed — research artifact for the Advisor epic · **Owner:** platform (Talent + Marketplace, CEO seat as buyer) · **Created:** 2026-09-16
**Board:** epic #2545 · spec `400b7152-cd22-48da-afcb-8a791ac6cdfd` · roadmap `69584c3f-0b8c-49fe-975a-e40a7e1f0648`
**Companion to:** [PRD 21 §11.5](./21-prd-unified-experience.md) (four marketplace families), [PRD 19 B7/B9](./19-prd-burnrateos-consolidation.md) (bookings, LMS, consultants), [PRD-marketplace-v2.md](./PRD-marketplace-v2.md)
**Implementation notes:** [26 — Advisor Platform implementation notes](./26-implementation-notes-advisor-platform.md) (composition / bind contract)
**Research source:** SCORE.org public feature set (mentoring, workshops, Academy, templates, chapters, lifecycle), captured 2026-09-16. SCORE is a U.S. SBA resource partner (since 1964). This PRD uses it as a **capability checklist**, not as a product to reproduce.

---

## 1. Verdict

SCORE.org is a **one-stop support platform for U.S. entrepreneurs**: free confidential 1:1 mentoring with volunteer professionals, plus workshops, an Academy, downloadable templates, a content library, and local chapters. It is useful because it pairs **a person** with **tools the founder can use the same day**.

Builderforce already has every *shape* SCORE sells:

| SCORE shape | Builderforce primitive that already exists |
|---|---|
| 1:1 mentoring | `booking_services` mode `one_to_one` ([bookings.ts](../../api/src/application/commerce/bookings.ts)); meetings + ceremony sessions; Brain chat |
| Workshops / webinars / office hours | `booking_services` mode `one_to_many` (`capacity > 1`); calendar events with `category: meeting` |
| Academy / self-paced courses | People-domain LMS (`courses`, modules, lessons, enrolments, cohorts, certificates, SCORM/xAPI); canvas listing kind `course` |
| Templates, checklists, worksheets | listing kinds `template`, `playbook`, `tool`, `survey`, `pack` |
| Articles / guides | `marketplace_knowledge`; public knowledge documents; blog |
| “Find someone who has done this” | Marketplace **Talent** family (`person` · `gig`); company `seeking` already includes `advisors` and `mentorship` ([startupListing.ts](../../packages/creation-canvas-contract/src/startupListing.ts)) |
| Expertise match | `EXPERTISE_AREAS` (product, marketing, operations, finance, legal, people, technology, BD, fundraising, international) |
| Confidentiality | canvas `CONFIDENTIALITY_LEVELS`; mentoring objects must default `restricted` |
| Lifecycle (idea → exit) | `BUSINESS_STAGES` (`idea` · `mvp` · `early_revenue` · `growth` · `scale`) + domain seats (CFO, CRO, CHRO, …) as **AI** advisors |

What SCORE has that we do not is **composition**: a founder can ask “I need a mentor for a pre-seed raise” and get a person, a slot, a confidential thread, and a pack of tools in one motion. Those four things live in four bounded contexts today and never meet.

**Do not clone SCORE.** SCORE is a nonprofit volunteer network, U.S.-only, SBA-affiliated, free by constitution. Cloning it would mean a second product (chapters, volunteer roster, in-person workshops, SCORE Academy brand) that fights the marketplace we already sell. Builderforce’s Advisor platform is **marketplace-dogfooded composition**: human advisors list on Talent, book through the existing scheduling service, teach through the existing LMS, and publish tools as existing listing kinds. Seat agents stay in the **Agents** family. Free is a **price of 0**, not a separate product.

---

## 2. Why SCORE is the wrong product and the right checklist

### 2.1 What SCORE actually offers (the checklist)

1. **Free business mentoring** — 1:1 with volunteer professionals; confidential; video / phone / email / in-person; ongoing as the business evolves; covers planning, startup, marketing, finance, operations, growth.
2. **Workshops and webinars** — live online, in-person, on-demand, roundtables. Topics span start → grow.
3. **Online courses / SCORE Academy** — self-paced (start, manage, plan, marketing, finance, exit). Some Academy programmes are paid.
4. **Templates and tools** — business-plan, financial-statement and forecast templates, marketing tools, checklists, worksheets, guides.
5. **Articles and educational content** — lifecycle library (validate → launch → manage → scale → exit).
6. **Local chapters and events** — national platform + local mentor/workshop supply.
7. **Lifecycle coverage** — idea/startup, early operation, growth, transition/exit.

### 2.2 What we will not build

- A volunteer-only, nonprofit, SBA-partner network.
- U.S.-only eligibility or chapter offices.
- A parallel “Advisor” app, nav, or storefront next to Marketplace.
- A sixth canvas `LISTING_LAUNCH_MODE`. The five verbs (`play` · `open` · `run` · `preview` · `install`) describe **things**. Booking a person is Talent, not a canvas kind. Adding `advisor` to `MARKETPLACE_LISTING_KINDS` would file a human under Assets and force one publish form to serve two shapes — the failure PRD 21 already named.
- In-person venue management.
- SCORE branding, Academy curriculum IP, or “we are SCORE for X”.

### 2.3 What we will build instead

One founder journey, four existing families:

```
Founder (company.seeking ⊇ advisors|mentorship, business_stage = …)
        │
        ├─ Talent listing (person) ──► booking_service (one_to_one | one_to_many)
        │                               └─ calendar event + meeting + Brain thread
        ├─ Agents listing (seat)   ──► roster row (CFO/CRO/… already the AI mentor)
        ├─ Asset listing (course)  ──► LMS enrolment
        └─ Asset listing (pack/playbook/template/tool) ──► install on their board
```

The primary buyer action on a human advisor is **Book**, not Install. The service row already has duration, buffer, price, capacity and host. The storefront does not yet bind a Talent listing to that row, and no frontend calls `booking_services` (API-only today). That bind **is** the product.

---

## 3. Evidence — what is already in the repo

### 3.1 Marketplace families (do not add a fifth)

From [marketplaceFamilies.ts](../../frontend/src/lib/marketplaceFamilies.ts) and PRD 21 §11.5:

| Family | Kinds | Advisor use |
|---|---|---|
| **Talent** | `person` · `gig` | Human advisors. Availability + rate. CTA: Book / Message. |
| **Agents** | built-in · community | Seat agents as always-on AI mentors. CTA: Hire to roster. |
| **Assets** | `course` · `template` · `playbook` · `tool` · `pack` · `survey` · … | Academy, templates, worksheets. CTA: Run / Install. |
| **Companies** | claimed businesses | Demand side: `seeking: advisors \| mentorship`. |

`/marketplace?family=talent` and `/marketplace?family=talent&kind=gig` already exist in `navGroups.ts`.

### 3.2 Scheduling (the mentoring runtime)

[bookings.ts](../../api/src/application/commerce/bookings.ts) (PRD 19 §9):

- Modes: `one_to_one` · `one_to_many` · `round_robin`.
- `one_to_many` **is** a webinar / office hours: capacity counted per slot, overlap refused in a transaction, buffers applied on the write.
- Reservations: `confirmed` · `cancelled` · `completed` · `no_show`.
- `availability_slots` remains the single source of “free”.

**Gap:** no frontend import of `bookingServices`. Mentoring cannot be booked from the storefront today.

### 3.3 Calendar and meetings

A `calendar` object bound to a source ([calendar.ts](../../packages/creation-canvas-contract/src/calendar.ts)). Events carry `category` (`meeting`, …). Ceremony sessions already open a `meetings` row with attendees. Voice/video is PRD 18 (hired.video), not a new stack.

### 3.4 LMS / Academy

People domain ([entities.ts](../../api/src/application/domains/people/entities.ts)): `courses`, `courseModules`, `courseLessons`, `courseEnrollments`, `learningCohorts`, `courseCertificates`, `courseCheckouts`, SCORM CMI + xAPI LRS. Canvas listing kind `course` launches `run` with harness `instrument`.

**Gap:** no curated founder curriculum by `BUSINESS_STAGES`. The tables exist; the Academy pack does not.

### 3.5 Demand already on the company row

`SEEKING_TYPES` includes `advisors` and `mentorship`. `EXPERTISE_AREAS` is the match vocabulary. `BUSINESS_STAGES` is the lifecycle axis. Matching is a **filter over existing columns**, not a new directory.

### 3.6 Confidentiality

Mentoring notes, transcripts and the Brain thread are the same class of object as a performance 1:1: named audience, never a public listing. Default `restricted`. Do not invent a sixth confidentiality level.

---

## 4. Product — the composed journey

### 4.1 Personas

| Role | Who | What they do |
|---|---|---|
| **Founder** | First buyer (ROADMAP: raising in the next few months) | Declares `seeking`, books 1:1s, enrols in a course, installs a pack |
| **Human advisor** | Operator, operator-turned-mentor, freelancer | Publishes a Talent listing, binds a booking service, optionally publishes a course/pack |
| **Seat agent** | Built-in CFO/CRO/CHRO/… | Already the always-on mentor; Advisor does not replace them |
| **Operator (us)** | Marketplace | Curates a default “Founder toolkit” pack per stage; does not staff a volunteer network |

### 4.2 The four motions (SCORE checklist → one CTA each)

| SCORE | Motion | CTA | Writes |
|---|---|---|---|
| 1:1 mentoring | Book a Talent listing whose service is `one_to_one` | **Book** | `booking_reservations` + `meetings` + restricted Brain thread |
| Workshops | Book / join `one_to_many` | **Join** | same, capacity counted |
| Academy | Enrol in a `course` listing | **Take course** | `course_enrollments` (checkout if priced) |
| Templates | Install a `pack` / `playbook` / `template` / `tool` | **Install** | canvas objects on the founder’s board |
| Articles | Open knowledge | **Read** | nothing (or an acknowledgement) |
| Ongoing relationship | Mentoring **engagement** (not a new listing kind) | **Continue** | a kernel object linking founder company ↔ advisor person, holding the thread + upcoming slots |
| Local chapter | Optional `geo` filter on Talent + `one_to_many` events | **Near me** | no chapter table |

### 4.3 Matching (no new matching engine)

Rank Talent listings for a founder by, in order:

1. Overlap of listing expertise with the founder’s current question (or `EXPERTISE_AREAS` they picked).
2. Advisor `business_stage` experience vs company `business_stage`.
3. `seeking` already `advisors` / `mentorship` (demand is declared).
4. Price (0 first if the founder filtered Free).
5. Optional geo — never required. Builderforce is global-first; SCORE is local-first. That is a difference we keep.

Do not introduce a “SCORE match score” column. The rank is a query.

### 4.4 Price

SCORE’s “free” is `priceCents = 0` on the booking service and `price = 0` on the listing (Marketplace V2 already renders “Free”). Paid advisors, paid Academy, and free volunteer-style listings **share one storefront**. No second “community” catalogue.

---

## 5. Functional requirements

### FR-1 — Bind Talent listing ↔ booking service

- **FR-1.1** A Talent `person` listing may reference one or more `booking_services` (1:1 mentoring, office hours, workshop).
- **FR-1.2** The storefront primary button is **Book** when a service is bound, **Message** when it is not. It is never Install.
- **FR-1.3** Publishing an advisor does not require a canvas object. It is the existing Talent publish flow plus the bind.
- **FR-1.4** Do not add `advisor` to `MARKETPLACE_LISTING_KINDS`.

### FR-2 — Founder can complete a 1:1 without leaving Marketplace

- **FR-2.1** Pick a slot from `availability_slots` (host’s free time).
- **FR-2.2** `reserve` refuses overlap inside a transaction (already true); the UI must surface the 409, not double-book in the calendar.
- **FR-2.3** On confirm: meeting row, calendar event, restricted Brain thread between founder and advisor.
- **FR-2.4** Channel is whatever the workspace already has (in-app + video when PRD 18 is live). Email/phone are contact fields on the person, not a new stack.
- **FR-2.5** Skip the POST while the founder is offline the same way visitor telemetry does — booking is **not** fire-and-forget; show an in-flow error, never the global API-error toast for a missed availability fetch.

### FR-3 — Workshops are `one_to_many`, not a new kind

- **FR-3.1** A workshop is a booking service with `capacity > 1` plus a calendar event.
- **FR-3.2** The public catalogue is Marketplace filtered to Talent listings that have a future `one_to_many` slot. No `/webinars` destination (PRD 21: authenticated work is a destination or a canvas object, never a new page).

### FR-4 — Academy is LMS + `course` listings

- **FR-4.1** A “Founder Academy” is a curated set of `course` listings tagged with `BUSINESS_STAGES`, not a new product.
- **FR-4.2** Enrolment and certificates stay in the People domain.
- **FR-4.3** Paid courses use existing `courseCheckouts`. Free courses are price 0.

### FR-5 — Toolkit is a `pack`

- **FR-5.1** Ship one default pack per `BUSINESS_STAGES` value (idea, mvp, early_revenue, growth, scale) containing playbooks/templates/tools that already exist or are authored as knowledge → canvas objects.
- **FR-5.2** The SCORE template list (business plan, forecast, marketing, checklists) is the **acceptance content** of the idea + mvp packs, not a parallel file dump.

### FR-6 — Engagement (ongoing mentoring)

- **FR-6.1** After the first completed reservation, offer **Continue with this advisor**. That writes an engagement object (kernel `objects` row, kind `mentoringEngagement` or reuse an existing relation — decide in implementation; **prefer a column/relation over a new table**).
- **FR-6.2** The engagement is the home of the confidential thread and the next slots. It is not a listing.

### FR-7 — Confidentiality

- **FR-7.1** Mentoring threads, notes, and transcripts default `restricted`.
- **FR-7.2** They must not cross `guest`, `share`, `publicMedia`, or `aiContext` without an explicit founder act (existing `confidentialityAtMost` table).
- **FR-7.3** The advisor’s **public** listing (bio, expertise, rate, free/paid) stays public. Only the work product of a session is restricted.

### FR-8 — AI seats remain the always-on mentor

- **FR-8.1** Hiring a human advisor does not remove the CFO/CRO/… seat from the roster.
- **FR-8.2** The seat agent may sit in the same engagement thread as a **participant**, with `aiContext` ceiling respected (FR-7.2). Default: agent is out of the restricted thread until the founder invites it.

---

## 6. Out of scope

- Volunteer background checks, SBA affiliation, 501(c)(3) operations.
- Chapter legal entities, local office hours in physical space.
- A dedicated Advisor destination, rail item, or marketing site parallel to Marketplace.
- New launch modes or listing kinds for humans.
- Building an LMS (it exists).
- Building a calendar (it exists).
- Building checkout (Marketplace V2 / Stripe path exists).
- In-person SCORE-style workshops as a logistics product.

---

## 7. Sequence

| Track | What ships | Proof form | Kill condition |
|---|---|---|---|
| **A0 · Bind** | Talent listing ↔ `booking_services`; Book CTA on `/marketplace?family=talent` | clickable-prototype | A founder cannot reserve a 1:1 from a listing without leaving the storefront |
| **A1 · Session** | Reservation → meeting + calendar + restricted Brain thread | smoke-test | The thread is readable on a shared board or appears in `aiContext` by default |
| **A2 · Group** | `one_to_many` join from the same listing | smoke-test | Two founders can occupy the same slot past `capacity` |
| **A3 · Academy** | Stage-tagged course listings + enrolment | live-system | Enrolment does not write `course_enrollments` |
| **A4 · Toolkit** | One pack per `BUSINESS_STAGES` | live-system | Install does not land playbook/template objects on the founder board |
| **A5 · Engagement** | Continue-with-this-advisor | poc | A second booking cannot find the first thread |

**A0 is the only track that unblocks the SCORE checklist.** A1–A5 are additive. Do not start A3–A5 before A0 is measurable.

Read and Prove spend no run budget; only Build does. Each proof names the kill condition above.

---

## 8. Acceptance (epic)

A founder whose company has `seeking: mentorship` and `business_stage: mvp` can, on Marketplace, without a new destination:

1. See human advisors ranked by expertise/stage, including Free (`price = 0`).
2. Book a 1:1 into a real `booking_reservations` row that refuses overlap.
3. Land in a restricted thread + calendar event with that advisor.
4. Join a future `one_to_many` slot (workshop) from the same family.
5. Enrol in a stage-tagged course and install the mvp toolkit pack.
6. Hire a seat agent without dropping the human advisor.

A reviewer can kill the epic if any of those six requires a `/advisors` page, a new listing family, or a volunteer/chapter table.

---

## 9. Open decisions — operator, not engineering

1. **Default price.** Seed listings at $0 (SCORE-like) or leave empty until advisors set a rate? Recommendation: allow 0; do not force 0.
2. **Engagement object.** New kernel kind vs a relation on `objects`. Recommendation: relation, no new table.
3. **Geo.** Ship “Near me” in A0 or defer? Recommendation: defer. Global-first.
4. **Invite the seat agent into the restricted thread.** Default off (FR-8.2) vs default on. Recommendation: off.

---

## 10. Claim-to-proof

Public copy may say we **compose mentoring, workshops, courses and templates on the marketplace**. It may not say we are a SCORE alternative, an SBA partner, or that mentoring is free unless a live listing is actually priced 0. No accounting or LMS claim that has not run against production data.
