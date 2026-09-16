# PRD 27 — Validating an idea: ask the market from the scratchpad

**Status:** Proposed — implementation spec, not yet started. Tracks B0–B5 (§7) are the survey loop; §11 hands over eight adjacent gaps found while mapping it, each independently implementable · **Owner:** platform (Canvas + Growth, CEO/CMO seats as buyer) · **Created:** 2026-09-15
**Board:** unassigned — no epic/spec/roadmap row exists yet (see §9.5)
**Companion to:** [PRD 19](./19-prd-burnrateos-consolidation.md) (BurnRateOS consolidation), [PRD 25](./25-prd-vertical-kpi-dashboards.md) (measurement as a product), [PRD 26](./26-prd-advisor-platform.md) (compose existing primitives, do not add a family)
**Depends on:** the idea scratchpad (frontend `2026.9.32`–`2026.9.33`; `idea` kind + `ideas` surface)
**Research source:** BurnRateOS `/ideas` feature set, captured 2026-09-15 — idea capture, customer interviews, and validating an idea by asking a distribution list. Used as a **capability checklist**, not a product to reproduce.

---

## 1. Verdict

The scratchpad shipped the first half of validation: a founder can write an idea down, name its riskiest assumptions, and link the interviews that tested it. The second half — **go ask people, and let their answers decide the idea's fate** — has every rail built and no seam between them.

| What validating an idea needs | What already exists | State |
|---|---|---|
| Somewhere to write the idea | `idea` kind + `ideas` surface | **Shipped** |
| A question set with a public address | `question_sets`/`responses` + [formPublishing.ts](../../api/src/application/collection/formPublishing.ts) + [/f/[slug]](../../frontend/src/app/f/%5Bslug%5D/page.tsx) | **Server complete, no front door** |
| Questions drafted from the idea | nothing | **Missing** |
| A list of prospective customers | `sales_contacts`, `ri_prospects`, `lists`, `marketing_audiences` | **Four stores, no join** |
| Sending to that list | [campaign rail](../../api/src/application/marketing/campaign/) — audiences, senders, mailboxes, templates, per-recipient open/click | **Shipped, forms cannot reach it** |
| Other channels | `/api/social/campaigns`, the public `/f/<slug>` link | **Shipped** |
| Reading the answers back | `summarizeForm` | **Server complete, zero frontend callers** |
| The answers changing the idea | `idea.evidence` counts only `customerInterview`/`experiment` | **Missing** |

**This is a wiring PRD, not a build-a-survey-tool PRD.** No new table. No new canvas kind. `form` — declared in [peopleObjects.ts:439](../../frontend/src/lib/peopleObjects.ts#L439) as THE collection primitive — is the survey. Migration [0469](../../api/migrations/0469_founder_operations.sql#L55-L98) already refused `published_forms`/`form_responses` on the grounds that twelve survey tables and thirteen answer tables had been collapsed into one kernel store. Adding a `survey` kind now would re-open exactly that.

It also closes the loop the platform has never closed. Interviews, experiments and forms are all typed in by hand today; nothing measures itself. The survey loop would be the **first validation loop in the product that produces its own numbers**, because the campaign tracker and `summarizeForm` already do.

---

## 2. What BurnRateOS offers, and what we build instead

### 2.1 The checklist

1. **Idea scratchpad** — write ideas down as they arrive, before they are worth a document.
2. **Customer interviews** — structured conversations recorded against an idea.
3. **Validate by asking** — turn an idea into a survey, send it to a distribution list of prospective customers, and see whether they respond.
4. **AI-drafted surveys** — the questions come from the idea, not from a blank form builder.
5. **Multi-channel distribution** — a direct shareable link, email to a list, social posts, an event.
6. **Measurement** — response counts and answer distribution decide whether the idea survives.

Items 1 and 2 shipped. This PRD is 3–6.

### 2.2 What we will not build

- A `survey` (or `questionnaire`, or `nps`) canvas kind. `form` is the kind; a survey is what you call one pointed at prospects.
- `published_forms` / `form_responses`, or any second answer store. [0469](../../api/migrations/0469_founder_operations.sql#L55-L98) settled this.
- A fifth contact store. There are already four (§3.5) and the fix is one directional join, not another list.
- A standalone `/surveys` destination. `/surveys` already exists and already redirects to `/insights/devex?panel=surveys` ([page.tsx:34](../../frontend/src/app/surveys/page.tsx#L34)); adding a second one re-creates what was retired.
- A webinar feature. `booking_services` with `capacity > 1` and the public [/book/[token]](../../frontend/src/app/book/%5Btoken%5D/page.tsx) page are the event rail; a webinar is a booking, not a new subsystem.
- A generic "generate anything from any card" tool. That is a larger design (see [canvas-one-composer-design]) and this PRD must not pre-empt it.

### 2.3 What we will build instead

```
idea (ideas surface)
  │
  ├─ "Ask people"  ─────────────► form  (question_sets kind='form')
  │     idea.test drafts questions      │
  │     testedBy ← form title           ├─ publish ──► /f/<slug>            (link: paste anywhere)
  │     stage → validating              ├─ send ────► marketing_campaign   (email: opens + clicks)
  │                                     └─ post ────► social_campaign      (social)
  │                                              │
  └─ evidence ◄── responses ◄── summarizeForm ◄──┘
        idea stage → validated | dropped
```

Every arrow but two already exists. The two are **"Ask people"** and **form → campaign**.

---

## 3. Evidence — what is already in the repo

### 3.1 The collection kernel

- `question_sets` ([0418:415](../../api/migrations/0418_kernel_primitives.sql#L415)) — `kind` discriminates `form` from `poll`; `questions` jsonb, `audience`, `opens_at`, `closes_at`.
- `responses` ([0418:433](../../api/migrations/0418_kernel_primitives.sql#L433)) — one row per answer, keyed by `question_key`, optional `object_id` back to the canvas card.
- [0469](../../api/migrations/0469_founder_operations.sql#L87-L120) adds `slug` (the public address), `anonymous`, `object_id`, `responses.submission_id`, and `form_recipients` (email + `token_hash` + `responded_at`).
- [0479](../../api/migrations/0479_form_reminder_cadence.sql#L28) adds `remind_after_days` / `last_reminded_at` and the reminder sweep index.

### 3.2 The form server — complete, and unreachable

[formPublishing.ts](../../api/src/application/collection/formPublishing.ts): `publishForm`, `mintPublicSlug`, `resolvePublicForm`, `submitFormResponse`, `summarizeForm`, `closeForm`, `formRemindersDue`, `reissueRecipientToken`.
[formInvitations.ts](../../api/src/application/collection/formInvitations.ts): `deliverFormInvitations`, `runFormReminderSweep`.
Routes ([formRoutes.ts](../../api/src/presentation/routes/formRoutes.ts)): authed `POST /publish`, `POST /:id/close`, `GET /:id/summary`; public `GET /:slug`, `POST /:slug`.
Responder: [/f/[slug]](../../frontend/src/app/f/%5Bslug%5D/page.tsx) → `PublicFormResponder.tsx`, nine field types, `?t=` recipient token.

**Gap.** [founderOpsApi.ts:49-53](../../frontend/src/lib/founderOpsApi.ts#L49-L53) declares `publishForm` and `closeForm`; **nothing in `frontend/src` calls either** (verified 2026-09-15). `summarizeForm` has no client at all. There is no form surface, and no `kind === 'form'` branch in the canvas host. The `poll` twin has the complete loop ([CanvasFacilitateSurface.tsx](../../frontend/src/components/creation-canvas/CanvasFacilitateSurface.tsx)); `form` is a finished server with no front door.

### 3.3 The idea scratchpad

[ideaLog.ts](../../frontend/src/lib/ideaLog.ts) — `ideaStage`, `ideaTestedBy`, `withTestedBy`, `ideaFromScratch`, `ideaLogEntries`, `untestedIdeaCount`.
[CanvasIdeasSurface.tsx:99-109](../../frontend/src/components/creation-canvas/CanvasIdeasSurface.tsx#L99-L109) — **"Plan an interview" is the precedent this PRD copies**: it creates the related object, writes `testedBy` back onto the idea, and advances the stage to `validating`, with no AI at all. "Ask people" is that exact shape with a `form` on the other end.
`idea.evidence` ([founderObjects.ts:638-657](../../frontend/src/lib/founderObjects.ts#L638-L657)) counts `testedBy` refs that resolve to `customerInterview` or `experiment` on the board.

### 3.4 The campaign rail

Tables ([0412 §E](../../api/migrations/0412_site_backend_domains_and_campaigns.sql#L160), [0414](../../api/migrations/0414_mailbox_connections_and_campaign_studio.sql), [0940](../../api/migrations/0940_sms_campaign_channel_and_scheduling.sql)): `marketing_audiences`, `marketing_audience_members`, `marketing_suppressions`, `marketing_sender_identities`, `mailbox_connections`, `marketing_templates`, `marketing_campaigns`, `marketing_campaign_sends`.
Use cases in [campaign/](../../api/src/application/marketing/campaign/): `startCampaign`, `runCampaignBatch` (batch 25, 3 attempts), `renderCampaignEmail` (rewrites every href through the click tracker, appends unsubscribe + open pixel), `recordOpen`/`recordClick`/`recordUnsubscribe`, `runCampaignSendSweep`, `startDueCampaigns`.
Public tracking at `/api/campaign-track/*`; opens and clicks fire the `email-open` / `email-click` workflow triggers.
UI: [/growth](../../frontend/src/app/growth/page.tsx) — Mailboxes · Audiences · Senders · Brand · Templates · Campaigns.

**This is the measurement the survey loop inherits for free.** Nothing here needs building; a form has to be able to become a campaign body.

### 3.5 Contacts — four stores, no join

There is no `contacts` table. A contact is a string `contact_ref`.

| Store | Where | Scope |
|---|---|---|
| `sales_contacts` | [0401:2](../../api/migrations/0401_sales_associate_crm.sql#L2) | per `owner_user_id`, **not tenant-scoped** |
| `ri_prospects`, `lists` (`scope='contact'`) | [0421:189,231](../../api/migrations/0421_revenue_and_crm_domain.sql#L189) | tenant |
| `marketing_audience_members` | [0412](../../api/migrations/0412_site_backend_domains_and_campaigns.sql#L200) | tenant; the only one the send engine reads |
| `newsletter_subscribers` | [0015:13](../../api/migrations/0015_newsletter_crm.sql#L13) | global, marketing site; nothing sends to it |

**Nothing joins any of the first three to the fourth.** Getting a prospect list into a campaign today means `POST /api/growth/audiences/:id/members` by hand, or a published-site form ([siteData.ts:238](../../api/src/application/ide/siteData.ts#L238), `source: 'site-form'`).

### 3.6 Connected actions — and the defect at the centre of this PRD

[CONNECTED_CANVAS_ACTIONS](../../frontend/src/domains/canvas/domain/canvasChange.ts#L59) says which advertised capabilities have a real adapter. Its own header:

> A kind listed here without one produces the honest-but-useless "no delivery adapter is connected" answer forever, which is **worse than not advertising the act at all** — the user is told the platform can do a thing and then told it cannot, by the same platform, one click apart.

`idea` advertises `actions: ['explore','test']` ([founderObjects.ts:626](../../frontend/src/lib/founderObjects.ts#L626)) and **is not in that map**. Both verbs are precisely the failure the list exists to prevent. `poll: ['publish','open','close','reveal']` is the shape `form` and `idea` should reach.
[DEDICATED_ACTION_TOOLS](../../frontend/src/components/creation-canvas/CreationCanvas.tsx#L602) is the alternative seam when an act needs arguments the generic one cannot carry; it is consulted first, at [:8910](../../frontend/src/components/creation-canvas/CreationCanvas.tsx#L8910).

### 3.7 Three phantom references (fix in this pass)

| Promised | Where | Reality |
|---|---|---|
| `canvas_publish_form` | [peopleObjects.ts:457](../../frontend/src/lib/peopleObjects.ts#L457) — "The public URL, written by canvas_publish_form" | **Does not exist.** Only occurrence in source is that hint. |
| `IDEA_EVIDENCE_KINDS` | [ideaLog.ts:28](../../frontend/src/lib/ideaLog.ts#L28) | **Zero consumers** (verified repo-wide). `founderObjects.ts:648` hardcodes the same two kinds, so the constant and the behaviour can drift. |
| `builtin_canvas_bind_ab_test` | [founderObjects.ts:703-709](../../frontend/src/lib/founderObjects.ts#L703-L709) — will "overwrite `variants` with what the split actually measured" | **Does not exist.** Every `experiment` therefore resolves to `evidence.authored`; nothing is ever measured. Adjacent, not in scope — see §6. |

---

## 4. Product

### 4.1 Personas

| Role | Who | What they do |
|---|---|---|
| **Founder** | Primary buyer, phase `idea` | Jots an idea, asks people, reads whether it survived |
| **Operator/CMO seat** | Owns `/growth` | Owns the audience, the sender identity and suppression |
| **Respondent** | A prospective customer | Opens a link, answers, never signs in |
| **Brain** | The drafting agent | Turns an idea's problem + riskiest assumptions into a question set |

### 4.2 The motions

| Motion | Where | CTA | Writes |
|---|---|---|---|
| Ask people about this idea | Ideas surface row | **Ask people** | `form` object + `testedBy` on the idea + stage → `validating` |
| Draft the questions | `idea.test` action | **Test** | `questions` on the form card |
| Publish | Form surface | **Publish** | `question_sets` row + `slug`; `shareUrl` onto the card |
| Send to a list | Form surface | **Send** | `marketing_campaign` + `marketing_campaign_sends` |
| Build the list from the CRM | Form surface / `/growth` | **Add from CRM** | `marketing_audience_members` |
| Post it | Form surface | **Post** | `social_campaign` |
| Read the answers | Form surface + card | (automatic) | `responseCount`, `completionRate`, `distribution`, `responses` |
| Settle the idea | Ideas surface | **Validated / Dropped** | `idea.stage` |

---

## 5. Functional requirements

### FR-1 — `form` becomes a connected kind
Add `form: ['publish','collect','close']` to `CONNECTED_CANVAS_ACTIONS`, mirroring `poll`. `publish` mints the slug and opens submissions; `collect` folds `summarizeForm` onto the card; `close` stops submissions. No verb is advertised without an adapter.

### FR-2 — A form surface
A new board surface, the twin of `CanvasFacilitateSurface`: edit the question set, choose audience (`anyoneWithLink` · `workspace` · `namedRecipients`), publish, show the share URL, list recipients with who has not answered, and render the response summary. Registered in [canvasSurfaces.ts](../../frontend/src/lib/canvasSurfaces.ts) with a **unique `order`** (a test asserts uniqueness) **and in `PHASE_SURFACES` in [canvasPhases.ts](../../frontend/src/lib/canvasPhases.ts)** — a surface absent from that map registers and never appears, which is exactly how the Ideas surface shipped invisible.

### FR-3 — "Ask people" on the Ideas surface
A row action beside "Plan an interview", implemented the same way ([CanvasIdeasSurface.tsx:99-109](../../frontend/src/components/creation-canvas/CanvasIdeasSurface.tsx#L99-L109)): create a `form`, write its title into `testedBy`, advance a `captured`/`exploring` idea to `validating`. Disabled, not hidden, when the viewer cannot edit.

### FR-4 — `idea.test` drafts the questions
Wire `idea: ['test']` into `CONNECTED_CANVAS_ACTIONS` with a `CARD_ACTS` runner that drafts a question set from the idea's `problem`, `segment` and `riskiestAssumptions` onto the linked `form`. If it needs arguments the generic seam cannot carry, register a dedicated tool in `DEDICATED_ACTION_TOOLS` instead — do not leave the verb advertised and unconnected.
**FR-4.1** Either implement `canvas_publish_form` or correct the hint at [peopleObjects.ts:457](../../frontend/src/lib/peopleObjects.ts#L457). A field hint naming a non-existent tool teaches the model to call it.
**FR-4.2** `idea.explore` is advertised and unconnected. Connect it, or remove it from the spec's `actions`.

### FR-5 — A form counts as evidence
Add `form` to `IDEA_EVIDENCE_KINDS`, **and make [founderObjects.ts:648](../../frontend/src/lib/founderObjects.ts#L648) read that constant** instead of hardcoding the list — the duplication is the defect, adding a third kind to both places is not the fix. `idea.evidence` verdicts must distinguish a form that is published-but-unanswered from one with responses.

### FR-6 — A published form can be sent to an audience
A **Send** act that creates a `marketing_campaign` whose body carries the form's public URL, against a chosen `marketing_audience`, through the existing transports. Reuses `startCampaign`/`runCampaignBatch` — no second send path. Opens and clicks land in `marketing_campaign_sends` as they already do.
**FR-6.1** Respect `marketing_suppressions` and sender verification; surface `CAMPAIGN_BLOCKERS` before the send, not after.
**FR-6.2** `namedRecipients` forms already have per-recipient tokens (`form_recipients`). When the audience is named, the send must carry each recipient's own `?t=` token so non-responders are chaseable.

### FR-7 — Build an audience from BuilderForce's own CRM
One directional join: select from `sales_contacts` / `ri_prospects` / a `lists` row with `scope='contact'` and add them as `marketing_audience_members` with `source='crm'`.
**FR-7.1 No fifth store, and no new contact table.** The audience stays the membership projection the send engine reads.
**FR-7.2** De-duplicate on email against the existing unique `(audience_id, email)`; report how many were added, skipped as duplicates, and skipped as suppressed.
**FR-7.3** `sales_contacts` is scoped to `owner_user_id`, not to the tenant. A user may only pull their own rows; state this in the use case, and do not widen the scope to make the join easier.
**FR-7.4** The selection read is list-shaped and repeated — serve it through `getOrSetCached` and invalidate on membership write.

### FR-8 — The answers settle the idea
The form card's derived fields (`responseCount`, `completionRate`, `distribution`, `responses`) fold onto the board via `collect`. From the Ideas surface a founder moves the idea to `validated` or `dropped` with the response summary visible. **Neither transition is automatic** — a response count is evidence, not a verdict.

### FR-9 — Every channel produces one measurable answer
The share link, the email campaign and the social post all point at the same `/f/<slug>`, so `responseCount` is one number regardless of channel.
**FR-9.1** Per-channel attribution is **not** in scope: `marketing_campaign_sends.clicked_at` is a single nullable timestamp and there is no `click_events` table, so "which channel produced this response" cannot be answered without new storage. Do not imply it in the UI.

### FR-10 — Localization, theme, responsive
Every new string through next-intl in all five catalogs (en, zh, es, fr, de) with real translations. All colour from theme tokens, correct in both themes, no viewport overflow near 360px. The public `/f/<slug>` responder is seen by people who are not customers — it must be correct in both themes.

### FR-11 — Ship the release note and the marketing
This clears the new-capability bar: a founder can do something they could not do before. A `category=new` release-note row through the superadmin surface, and a blog post built around the Idea→Make→Run→Measure arc per [run-your-app-on-the-canvas.md](../../frontend/src/content/blog/run-your-app-on-the-canvas.md), with `bf-figure` visuals and a "Where it sits in the method" section.

---

## 6. Out of scope for tracks B0–B5

Out of scope for the survey loop itself. **Everything in this list except the last two is specified for handover in §11** — it is adjacent work found while mapping this loop, not work to re-derive.

- `builtin_canvas_bind_ab_test` and measuring `experiment` cards (§3.7) → **§11.1**.
- SMS campaigns and scheduled sends → **§11.2**.
- Per-link and repeat click attribution → **§11.3**.
- Consolidating the four contact stores. FR-7 adds one join; it does not unify them → **§11.4**.
- `pulse_surveys`, DevEx surveys and the CSAT/NPS widget as bindings of `form` rather than competitors → **§11.5**, **§11.6**.
- The generic "generate a related object from this card" seam. A larger design ([canvas-one-composer-design]); this PRD must not pre-empt it.
- Webinars beyond `booking_services` with `capacity > 1`.

---

## 7. Sequence

| Track | What ships | Proof form | Kill condition |
|---|---|---|---|
| **B0 · Front door** | FR-1, FR-2 — `form` connected, form surface, publish, share URL, summary | clickable-prototype | A published form's `/f/<slug>` cannot be opened, or the surface is absent from `PHASE_SURFACES` |
| **B1 · From the idea** | FR-3, FR-5 — "Ask people", `testedBy`, form as evidence | smoke-test | Creating a form from an idea does not change `idea.evidence` |
| **B2 · Drafted** | FR-4 — `idea.test` connected | smoke-test | `idea.test` still answers "no real Canvas delivery adapter is connected" |
| **B3 · Sent** | FR-6 — form → campaign, opens and clicks | pilot | A send bypasses suppressions, or named recipients get a token-less link |
| **B4 · The list** | FR-7 — CRM → audience | pilot | The join reads another user's `sales_contacts`, or writes a fifth store |
| **B5 · Settled** | FR-8 — responses fold back, founder settles the idea | live-system | The stage changes without a human, or the summary is not visible when it does |

**B0 is the only track that unblocks the checklist.** B1–B5 are additive and ordered. Do not start B3 before B0 is measurable — a send with no front door is a campaign pointing at nothing.

Read and Prove spend no run budget; only Build does.

---

## 8. Acceptance (epic)

A founder in the `idea` phase, on one canvas, without a new destination:

1. Writes an idea on the Ideas surface and presses **Ask people**.
2. Gets a drafted question set they can edit, derived from the idea's own problem and riskiest assumptions.
3. Publishes it and gets a public URL that a stranger can answer without signing in.
4. Builds an audience from BuilderForce's own CRM and sends it, with opens and clicks tracked.
5. Posts the same link to social, and every channel feeds one response count.
6. Sees the response summary on the idea's own card as evidence.
7. Moves the idea to `validated` or `dropped` themselves, with that summary in view.

A reviewer can kill the epic if any of those requires a `survey` kind, a second answer store, a fifth contact store, a `/surveys` destination, or a second send path.

---

## 9. Open decisions — operator, not engineering

1. **Anonymous by default?** `anonymous: true` stores no respondent reference at all. Right for market validation, fatal for an acknowledgement. Recommendation: default anonymous for forms created from an idea, never for forms created anywhere else.
2. **Close date.** A form with no `closes_at` is one nobody chases. Recommendation: default 14 days on an idea-born form, editable.
3. **Who may send.** `/growth` writes are `manager`-gated; the Ideas surface is not. Recommendation: **Ask people** and **Publish** for any editor; **Send** keeps the manager gate.
4. **Suppression scope.** A prospect who unsubscribes from a validation survey is suppressed tenant-wide. Correct, and worth stating in the UI before the send.
5. **Board rows.** This PRD has no epic/spec/roadmap id, unlike PRD 26. Someone with a live session needs to create them if this is to be tracked like its siblings.

---

## 10. Claim-to-proof

Public copy may say a founder can **capture an idea, ask real people about it, and see the answers land on the idea itself**. It may not say the platform decides whether an idea is validated — a person does, on the evidence (FR-8). It may not claim channel attribution (FR-9.1), A/B measurement (no `bind_ab_test`), or that experiments are measured — none of which is true today. No response-rate or deliverability claim that has not run against production sends.

---

## 11. Adjacent work handed over

Found while mapping the survey loop on 2026-09-15, each verified against the tree on that date. Independent of tracks B0–B5 and of each other; take them in any order. Every item names its own evidence so none of this has to be re-derived.

### 11.0 House rules for whoever implements any of this

- `pnpm run check` from `frontend/` is the guard suite. `check:design-tokens` (every token declared in **both** themes), `check:design-scale` (no literal hex, radii from `--radius-*`, font sizes from `--font-size-*` roles), and `check:architecture` (a `useClientFiles` raise must be **argued in the changelog** at the top of `check-frontend-architecture.mjs`) all fail the deploy, not just the build.
- `'use client'` is a declaration. Never bulk-strip it; argue each removal in the file itself.
- A new canvas surface needs a **unique `order`** in `canvasSurfaces.ts` (a test asserts uniqueness) **and** an entry in `PHASE_SURFACES` in `canvasPhases.ts`. Missing the second registers a surface nobody can reach — see §11.7.
- Every user-facing string goes through next-intl in all five catalogs (en, zh, es, fr, de) with real translations, in the same pass.
- A new capability ships with a `category=new` release-note row and marketing; a bug fix does not.

### 11.1 — `experiment` cards are never measured

**Evidence.** [founderObjects.ts:703-709](../../frontend/src/lib/founderObjects.ts#L703-L709) promises `builtin_canvas_bind_ab_test` will bind `abTestKey` to a live `ab_tests` row and "overwrite `variants` with what the split actually measured". Repo-wide, that tool exists only in that hint. `experiment` is absent from `CONNECTED_CANVAS_ACTIONS`, so its advertised `['run','evaluate']` both answer "no real Canvas delivery adapter is connected". The `ab_tests` / `ab_test_variants` tables and `/api/growth-ops/tests/variants/:id/exposure|conversion` are real and live.

**Requirement.** Implement the tool so a bound experiment reads exposures and conversions from the real split, writes `variants`, and lets `evidence` resolve to `evidence.bound` instead of always `evidence.authored`. Connect `experiment: ['evaluate']`. If `run` has no adapter, remove it from the spec's `actions` rather than leaving it advertised.

**Kill condition.** A bound experiment still shows authored numbers, or `evidence.bound` remains unreachable.

### 11.2 — SMS and scheduled sends exist on the server and nowhere in the UI

**Evidence.** Server: `marketing_campaigns.channel` (email|sms), `body_text`, `from_number`, the `twilio` transport, `POST /api/campaign-track/sms-status/:token` with signature check ([0940](../../api/migrations/0940_sms_campaign_channel_and_scheduling.sql)). Scheduling: `scheduled_at` accepted by `POST`/`PATCH /api/growth/campaigns`, swept by `startDueCampaigns`, with a partial index on `(scheduled_at) WHERE status='draft'`.
Frontend: [growthApi.ts:170](../../frontend/src/lib/growthApi.ts#L170) types `CampaignTransport` as `'platform' | 'mailbox' | 'sendgrid'` — no `twilio`; `CampaignComposer.tsx:165` renders radios for those three only; and `createCampaign`/`updateCampaign` body types omit `scheduledAt` entirely. Both capabilities are reachable only by direct API call.

**Requirement.** Widen the client types and expose both in `CampaignComposer`: channel (email|sms) with `body_text` and `from_number` when SMS, and a schedule field. Respect `TRANSPORTS_BY_CHANNEL` — do not let the UI offer a transport the channel does not support.

**Kill condition.** A scheduled campaign sends immediately, or an SMS campaign can be composed with no `from_number`.

### 11.3 — Click measurement is "did they click anything", not "which link"

**Evidence.** `recordClick` validates the protocol and redirects, but the destination arrives as `?u=` and is **never persisted**; `marketing_campaign_sends.clicked_at` is a single nullable timestamp, first click only. There is no `click_events` table.

**Requirement.** Decide the storage shape before building — a per-link registry minted at render time (so the tracked URL carries a link id rather than the destination) is the shape that also stops the open redirect surface growing. Then: which link, how many times, per recipient. Keep the existing first-click `clicked_at` as the cheap aggregate rather than recomputing it per read.

**Note.** This is what FR-9.1 refuses to claim. Until it exists, no channel attribution in any UI.

### 11.4 — Four contact stores, one of which is not tenant-scoped

**Evidence.** §3.5. `sales_contacts` is scoped to `owner_user_id` and **not** to the tenant ([0401:2](../../api/migrations/0401_sales_associate_crm.sql#L2)). `ri_prospects` and `lists` are tenant-scoped. `marketing_audience_members` is the only one the send engine reads. `newsletter_subscribers` is global to the marketing site and nothing sends to it. A contact is a string `contact_ref`, not a row, and `ri_sequences` was deliberately left unwired (asserted by `revenueIntel.test.ts:198`).

**Requirement.** One contact identity, one owner, per the 3NF rule that a new kind is a column value and not a new table. `marketing_audience_members` stays the membership projection the send engine reads; it must not become the identity. FR-7 adds the one directional join this loop needs and deliberately does not unify anything — unification is this item.

**Operator decision first.** Which store is canonical, and what happens to `sales_contacts` rows that belong to a user rather than a workspace. Do not start until that is answered: the wrong choice here is a migration nobody can reverse.

### 11.5 — `pulse_surveys` and DevEx surveys are competitors to the collection primitive

**Evidence.** The contract says so out loud: [people.ts:124](../../packages/creation-canvas-contract/src/people.ts#L124) states `pulse_surveys` should become a **binding** of `form`, not a competitor. Today there are four separate collection systems beside the kernel: `pulse_surveys`/`pulse_responses` ([0317](../../api/migrations/0317_pulse_surveys.sql)), DevEx surveys ([0229](../../api/migrations/0229_devex_surveys.sql): templates, campaigns, responses), `feedback_collectors`/`feedback_submissions` ([0354](../../api/migrations/0354_feedback_collectors.sql)), and `site_collections`/`site_records` ([0412:122](../../api/migrations/0412_site_backend_domains_and_campaigns.sql#L122)).

**Requirement.** Migrate `pulse_surveys` onto `question_sets` with `kind='pulse'` and its answers onto `responses`, preserving the anonymous-aggregate guarantee. DevEx surveys follow the same shape but carry eNPS logic worth keeping — port the logic, not the tables. `feedback_collectors` and `site_collections` are public-ingest endpoints with their own rate limiting and are **not** obviously the same shape; assess before touching.

**Kill condition.** A migration that loses the anonymity guarantee on existing pulse responses.

### 11.6 — The CSAT/NPS widget has a `question_set_id` and no renderer

**Evidence.** `customer_engagement_feedback_widgets` ([0423:39](../../api/migrations/0423_support_and_knowledge_domain.sql#L39)) already carries `question_set_id`, `kind` (csat|nps|ces|freeform), placement, audience, theme and `cooldown_days`. `shouldPrompt` implements the cooldown ([customerSurface.ts:58](../../api/src/application/support/customerSurface.ts#L58)) and the `feedback_widget` embed flag exists. No renderer exists in `frontend/src`.

**Requirement.** Render it against the kernel store it already points at. This is the cheapest item on this list and the one closest to already working.

### 11.7 — Verification owed on the Ideas phase-surface fix

**Not a feature — an unverified change sitting in the working tree as of 2026-09-15.** The Ideas surface shipped registered but absent from `PHASE_SURFACES`, so it never appeared in the canvas header. The fix adds `'ideas'` to all five phases in [canvasPhases.ts](../../frontend/src/lib/canvasPhases.ts), guarded by a new [canvasPhases.test.ts](../../frontend/src/lib/canvasPhases.test.ts) that fails if any board surface is offered by no phase, if `ideas` is missing from any phase, or if a later phase drops a surface an earlier one had. `frontend/package.json` is bumped to `2026.9.33` and DONE.md records it.

**Owed:** from `frontend/` — `canvasPhases.test.ts`, `canvasSurfaces.test.tsx`, `canvasIdeasSurface.test.tsx`, `canvasSessionActions.test.tsx`, then `pnpm run type-check` and `pnpm run check`. Nothing is committed or pushed. Until it deploys, Ideas remains invisible in the header on every phase.

### 11.8 — `newsletter_subscribers` is a silo nothing sends to

**Evidence.** [0015:13](../../api/migrations/0015_newsletter_crm.sql#L13) — global, no tenant. `newsletter_events` has an enum including `email_opened`/`email_clicked`, but only subscribe/unsubscribe are ever written. `POST /api/auth/newsletter/subscribers` is the only writer. Separate from `marketing_audiences` in every respect.

**Requirement.** Either route it through the campaign rail (and honour `marketing_suppressions`, which it currently cannot see) or retire it. A subscriber list nobody can send to collects addresses under an implied promise the product does not keep.
