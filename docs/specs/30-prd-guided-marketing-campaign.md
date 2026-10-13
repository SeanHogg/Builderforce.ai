# PRD 30 — Prompt-driven marketing campaign (compose Growth, do not clone HubSpot)

**Status:** Proposed — first slice is the canvas journey prompt · **Owner:** platform (Growth / CMO seat) · **Created:** 2026-09-16
**Board:** epic #2547 · spec `57b8d17d-6269-40aa-840d-440170cbc26b` · roadmap `e5697b23-1f76-4b5b-9d3a-76f7129bc6f1` · chat #115
**Companion to:** [PRD 19](./19-prd-burnrateos-consolidation.md) (BurnRateOS CMO remainder), [06-marketing-parity-additions.md](./06-marketing-parity-additions.md) (Jira/Linear/DORA — **not** this journey), Growth seat `/seat/growth`

---

## 1. Verdict

A founder who says **“I want to run a marketing campaign”** is asking for a **run**: name the business, the vertical and the ICP, clear a short checklist, connect a channel, author copy, send only after confirm, then read **campaign ROI**.

Builderforce already has the **engines**. It does not have that **journey**. Today the same prompt is answered with a campaign **portfolio table** (`marketing.campaigns.list` in the executive catalog) or a bare refusal on an anonymous canvas (measured: “connect my email” with tools the turn did not have — `CreationCanvas.tsx` ~8986, `canvasAiSystemPrompt.ts` anonymous block).

| HubSpot-shaped ask | Builderforce primitive that already exists |
|---|---|
| Email / SMS blast | Growth `email_campaigns` + `campaign.create` (draft) / `campaign.send` (irreversible) · canvas kind `emailCampaign` · transports `platform` \| `mailbox` \| `sendgrid` |
| Audience | canvas kind `audience` · Growth audiences · `marketing_campaign_sends` idempotent per (campaign, recipient) |
| Brand | canvas kind `brandKit` · `BRAND_BOUND_KINDS` includes `emailCampaign` / `socialCampaign` / `emailTemplate` |
| Social announce + publish | `canvas_connect_social_account` (guest-gated) · `canvas_create_social_campaign` · `canvas_publish_social_campaign` (confirm; public; cannot undo) |
| Paid ads | `CanvasAdsPanel` / `adsApi` — created **paused** unless `launch`; spend is real money |
| ICP | CRO `ri_icps` (`revenue.ts`, migration 0421) — **API only, no frontend** |
| Delivery counters | campaign `sent` / `opened` / `clicked`; ads spend / impressions / clicks / conversions / CPC / CPA |
| Campaign ROI | **gap** — `canvasRunComparison.ts` names it; opens/clicks are not ROI |

**Do not clone HubSpot** (or the remaining BurnRateOS CMO tables: heatmaps, nurture streams, A/B). Those are a second product. This PRD **composes** Growth + canvas kinds + social/ads tools into one prompt-driven sequence. Cloud agents stay **draft/read only**. Anonymous canvases may **author**, never send.

---

## 2. Why HubSpot is the wrong product and the right checklist

### 2.1 What the founder actually needs (the checklist)

1. **Intake** — business, vertical, who it is for (ICP).
2. **Blockers on the board** — brandKit, consent-capable audience, offer/CTA, channel.
3. **Connect** — mailbox (email) or social accounts or ads account. Never type a password into chat.
4. **Copy** — `emailCampaign` / `emailTemplate` bound to brand; social via the SOCIAL tools (never a hand-authored `socialCampaign`).
5. **Confirm then send / publish / launch** — drafting is the default; send is irreversible; ads spend real money.
6. **Campaign ROI** — not opens, clicks, or follower counts. CAC / attributed revenue / ROAS against spend and pipeline. **Not v1.**

### 2.2 What we will not build

- A HubSpot clone: CRM-as-campaign, visual nurture builder, heatmaps, A/B as a v1 dependency.
- A second campaign product next to `/growth`.
- Autonomous `campaign.send`, `social_campaign.publish`, ads `launch`, or `marketing.generate_logo` on the cloud-agent path (`cloudAgentToolset.ts` already forbids them).
- Guest mailbox OAuth (anonymous boards have no tenant).
- Wiring `icpId` onto `campaign.create` as a hidden FK before there is a frontend ICP picker.
- Treating `/api/roi/rollup` (feature/portfolio ROI) or `marketingApi.ts` visitor diagnostics as campaign ROI.

### 2.3 What we will build instead

One founder journey, existing objects:

```
“I want to run a marketing campaign”
        │
        ├─ (1) INTAKE     audience + short document (business / vertical / ICP)
        ├─ (2) CHECKLIST  brandKit, consent audience, offer/CTA, channel
        ├─ (3) CONNECT    social: canvas_connect_social_account (every board)
        │                 email:  canvas_add_inbox on a tenant board;
        │                         else author locally and name the account gate
        ├─ (4) COPY       emailCampaign + emailTemplate via canvas_add_object
        │                 social via canvas_create_social_campaign (not add_object)
        └─ (5) CONFIRM    send / publish / launch only on an explicit user act
                          ROI is out of v1 — do not invent it
```

---

## 3. Evidence — what is already in the repo

### 3.1 Why the prompt becomes a table

`frontend/src/lib/promptUseCases.ts` — `marketing.campaigns.list` = “Create a campaign portfolio table from available email…”. `C_SUITE_CANVAS_OWNERS.executiveMarketing.objects` is `table, dashboard, report, chart, evaluation` — **no** `emailCampaign`. Closed catalog of 48 dotted ids. Adding a use-case is a coordinated bump (workflows, use-case array, i18n `promptUseCases.items`, round-trip tests). **Not this slice.** The canvas system prompt is the path the founder actually types on.

### 3.2 Canvas tools (do not name what the turn lacks)

| Tool | Class | Notes |
|---|---|---|
| `canvas_add_object` | guest-safe | Legal for `emailCampaign`, `audience`, `brandKit`, `emailTemplate`. **Illegal** for `socialCampaign` / `socialPost` / `socialFeed` (fake ledger). |
| `canvas_connect_social_account` | guest-gated | Opens the connect panel. Unconditional SOCIAL block already names it. |
| `canvas_create_social_campaign` / `canvas_publish_social_campaign` | guest-gated | Draft vs public publish. Confirm before publish. |
| `canvas_add_inbox` | **account-required** | Reads a connected mailbox onto the board. If none is connected, returns `Connect one in Growth → Mailboxes.` There is **no** `canvas_connect_mailbox` (OAuth lives on `CanvasEmailComposer` and Growth → Mailboxes). Naming this tool on an anonymous board is the 2026-08 “connect my email” failure. |

Rule 3 (`api/scripts/check-canvas-tool-contract.mjs`): a `canvas_*` name that reaches the model must be a name the model can call. Inbox instructions live behind `persistence === 'server'`.

### 3.3 Agent / Growth HTTP

`builtinMcpService.ts` `campaign.create` → `POST /api/growth/campaigns` **draft only**. Required `name`, `audienceId`. No `icpId` / vertical / business. `campaign.send` is irreversible and **off** the autonomous toolset. `cloudAgentToolset.ts` allows `campaign.list` + `campaign.create` only.

### 3.4 ICP and ROI

- ICP: `ri_icps` in `revenue.ts` (~321), `revenueIntelligence.ts`, migration `0421_revenue_and_crm_domain.sql`. Frontend has **zero** `revenueIntelligence` / `icpFit` / `idealCustomer` call sites (copy only).
- Delivery ≠ ROI. Ads insights are a 28-day ledger (`VISIBLE_ROWS=60`), not attributed campaign ROI.

---

## 4. Sequence

| Track | What ships | Proof form | Kill condition |
|---|---|---|---|
| **C0 · Journey prompt** | Canvas system prompt walks intake → checklist → copy → confirm. Tenant boards name `canvas_add_inbox`. Anonymous boards still author `audience` / `brandKit` / `emailCampaign` and do not hear `canvas_add_inbox`. | smoke-test (`creationCanvasAi.test.ts` promptOf) | “Run a campaign” is still answered with a portfolio table, or a guest prompt names `canvas_add_inbox` |
| **C1 · Connect mailbox** | Guest-gated `canvas_connect_mailbox` mirroring social (open OAuth / composer; never ask for a password in chat) | clickable-prototype | “Connect my email” still dumps the user at a prose “go to Growth” with nothing on the board |
| **C2 · Catalog** | New executive use-case (do not overwrite `marketing.campaigns.list`) whose objects include `emailCampaign` / `audience` / `brandKit`; bump the 48-id contract | smoke-test | The C-suite starting point still only emits `table` |
| **C3 · ICP on canvas** | Read `ri_icps` onto an audience / document; still no hidden FK on `campaign.create` until a picker exists | poc | Campaign rows gain `icpId` with no UI |
| **C4 · Campaign ROI** | Attribute spend → pipeline, not opens/clicks. Explicit CMO-review gap. | live-system | A dashboard labelled ROI that is only opens/clicks |

**C0 is this slice.** C1–C4 are additive. Do not start C3–C4 before C0 is measurable. Do not send from cloud agents in any track.

---

## 5. Acceptance (epic)

A founder can type **“I want to run a marketing campaign”** on the Creation Canvas and, without a HubSpot tab:

1. Get a run (intake + checklist + copy objects), **not** a portfolio table.
2. On a **guest** board: brandKit / audience / emailCampaign authored locally; one sentence that send needs an account; **no** `canvas_add_inbox` in the prompt.
3. On a **tenant** board: `canvas_add_inbox` is named; a missing mailbox relays Growth → Mailboxes rather than a competitor.
4. Social follows the existing SOCIAL block (connect / draft / confirm-publish).
5. Nothing is sent, published, or spent unless the user confirmed in that turn.
6. The model does not invent CAC / ROAS / attributed revenue.

A reviewer can kill the epic if any of those six requires a new campaign app, a HubSpot import, autonomous send, or labelling opens as ROI.

---

## 6. Out of scope

- HubSpot CRM, workflows, heatmaps, nurture, A/B as v1.
- Cloud-agent send / publish / ads launch / logo generation.
- Frontend ICP picker (C3).
- Campaign ROI engine (C4).
- Overwriting `marketing.campaigns.list` (the portfolio table remains valid for “show me my campaigns”).
- `06-marketing-parity-additions.md` work (Jira/Linear/DORA/git/Slack).

---

## 7. Claim-to-proof

Public copy may say we **compose email, social and ads campaigns on the canvas from a prompt**. It may not say we are a HubSpot alternative, that cloud agents send campaigns, or that we report campaign ROI until C4 has run against production data.
