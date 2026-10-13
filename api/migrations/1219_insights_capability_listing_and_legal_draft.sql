-- 1219 · Insights (PRD 33 S6, D9): the `session-replay` capability listing, and the
-- session-recording disclosure as an UNPUBLISHED legal draft.
--
-- ── 1. THE LISTING ──────────────────────────────────────────────────────────────
-- Insights is installed through the Marketplace like any other product (D17,
-- Builderforce's own workspace included). The row is platform-published:
-- `tenant_id` NULL and `publisher_ref = 'builderforce'` — the only shape the
-- entitlement read (`heldCapabilities.ts`) and the pack ladder
-- (`replayCatalog.loadReplayCatalog`) accept, so a seller's look-alike listing can
-- neither grant access nor price a pack. `kind = 'capability'` is registered in
-- `MARKETPLACE_LISTING_KINDS` (deliveries: entitlement), so the public browse feed
-- shows it with no further edit.
--
-- `body` carries the D4 numbers the API reads at runtime: the free monthly units,
-- the unit size and the five prepaid packs. `launch`/`trial`/`delivery`/`seller`
-- are the fields every listing card reads (`listings/model.ts toView`).
--
-- Idempotent twice over: NULL tenant ids never collide on `uq_catalog_items_slug`,
-- so the NOT EXISTS guard is what stops a replay inserting a second row; slugs are
-- also globally unique by publish rule, so an existing `session-replay` slug (of any
-- owner) leaves this a no-op rather than a duplicate.
INSERT INTO catalog_items (
  tenant_id, kind, slug, name, summary, body, category, tags, version,
  visibility, price_cents, currency, publisher_ref, is_template, published_at
)
SELECT
  NULL,
  'capability',
  'session-replay',
  'Insights',
  'Watch what visitors do on your site, see where they get stuck, and get ranked fixes measured release by release. Session replay, heatmaps, funnels and live visitors with inputs masked in the browser. 5,000 recordings a month free; prepaid packs above that.',
  '{
     "addon": "session_replay",
     "freeMonthlyUnits": 5000,
     "unitBytes": 2097152,
     "packs": [
       {"id": "p10k",  "units": 10000,   "amountCents": 4000},
       {"id": "p50k",  "units": 50000,   "amountCents": 14000},
       {"id": "p150k", "units": 150000,  "amountCents": 24000},
       {"id": "p500k", "units": 500000,  "amountCents": 65000},
       {"id": "p1m",   "units": 1000000, "amountCents": 120000}
     ],
     "launch": "run",
     "trial": "full",
     "delivery": "entitlement",
     "seller": {"userId": "builderforce", "name": "Builderforce"}
   }'::jsonb,
  'analytics',
  '["insights", "session-replay", "heatmaps", "analytics"]'::jsonb,
  '1.0.0',
  'public',
  0,
  'USD',
  'builderforce',
  false,
  now()
WHERE NOT EXISTS (SELECT 1 FROM catalog_items WHERE slug = 'session-replay')
ON CONFLICT DO NOTHING;

-- ── 2. THE LEGAL DRAFT (D9) ─────────────────────────────────────────────────────
-- Signed-in recording on builderforce.ai stays off (`replay.recordSignedIn = false`)
-- until a disclosure is PUBLISHED. This writes that disclosure as a DRAFT version of
-- the Privacy Policy and the Terms of Use — a `legal_document_versions` row with
-- `change_kind = 'draft'`, built from the currently active text plus the new
-- section. It is never active, so nobody is asked to accept it and nothing changes
-- for users until an operator reviews it in Admin ▸ Compliance ▸ Legal (History)
-- and publishes it as a new version. This migration NEVER publishes.
INSERT INTO legal_document_versions (document_type, version, title, content, change_kind, changed_by, created_at)
SELECT
  d.document_type,
  '2.2.0',
  d.title,
  d.content || E'\n\n' || $privacy$## Session Recording and Insights

**What we record.** When you have accepted analytics cookies on builderforce.ai, we may record how you use our pages so we can see what works and what does not. A recording is a reconstruction of the page in your browser and of what happened on it: the page structure and visible content, pointer movements, clicks and taps, scrolling, the pages you visit in that visit, your viewport size, device type, browser and operating system, the referring site, your approximate country (derived from your IP address, which is not stored with the recording), page-performance timings, and script errors. We replay it like a video. It is not a screen capture: nothing outside the browser tab showing our site is ever recorded.

**What we never capture.** Text you type into form fields is masked in your browser before anything leaves your device. Password and payment-card fields are never captured at all. Areas of our pages that show account details, API keys or other sensitive information are marked to be masked or blocked. If your browser sends a Do Not Track or Global Privacy Control signal, recording does not start.

**Signed-in use.** We record signed-in sessions on builderforce.ai only once this section is in effect, and a workspace administrator may exclude their workspace from recording entirely. Recordings of signed-in sessions are linked to your account only so that you can ask us to delete them.

**Why we use it.** We use recordings and the statistics derived from them to find and fix defects, to understand where people get stuck, and to measure whether a change to the product helped. We may use automated tools, including AI models operated by the subprocessors listed on our subprocessor page, to summarise recordings and detect usability problems. We do not use recordings for advertising, we do not sell them, and we do not use them to build profiles of you.

**How long we keep it.** Recordings are kept for 30 days by default and never longer than 90 days. Aggregated daily statistics that contain no recording content (for example, how many visits reached a page) are kept for up to 13 months. When you ask us to delete your data, your recordings are deleted with it.

**How to opt out.** Decline analytics cookies in the cookie banner, or change your choice at any time from Cookie settings in the site footer; recording stops from your next page view. Enabling Do Not Track or Global Privacy Control in your browser has the same effect.

**Websites run by our customers.** Builderforce customers can install Insights on websites they operate. For those websites the customer decides what is recorded and why, and is the controller of that data; Builderforce processes it on the customer's behalf as a processor under our Data Processing Addendum. The customer is responsible for telling its visitors about recording and for obtaining any consent the law requires. If you visited a customer's website and want to exercise your rights over a recording, contact that website's operator; we will help them respond.$privacy$,
  'draft',
  NULL,
  now()
FROM legal_documents d
WHERE d.document_type = 'privacy'
  AND d.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM legal_document_versions v
    WHERE v.document_type = 'privacy' AND v.version = '2.2.0' AND v.change_kind = 'draft'
  )
ORDER BY d.published_at DESC
LIMIT 1;

INSERT INTO legal_document_versions (document_type, version, title, content, change_kind, changed_by, created_at)
SELECT
  d.document_type,
  '2.2.0',
  d.title,
  d.content || E'\n\n' || $terms$## Insights (Session Recording)

**The service.** Insights records how visitors use a website so that you can replay visits, see heatmaps and funnels, and receive suggested fixes. You may use it on builderforce.ai-hosted apps you publish and on websites you operate by adding the Insights loader tag with your site key.

**Your responsibilities.** When you record a website you operate, you are responsible for giving its visitors a clear notice that their visits are recorded, for obtaining any consent the law requires before recording starts (including under the GDPR and ePrivacy rules, the CCPA/CPRA, and state laws that require the consent of every party to a communication), and for honouring visitors' choices. Insights provides a "wait for consent" setting and a consent call for this purpose. You must not configure Insights to capture, and must mask or block any part of a page that displays: passwords or authentication secrets, full payment-card or bank-account numbers, government identification numbers, health information, or other special categories of personal data. You must not use Insights on a website directed at children under 13, or under 16 where the law sets that age.

**Data protection.** For recordings of your websites you are the controller and Builderforce is your processor; our Data Processing Addendum applies. Inputs are masked in the visitor's browser, recordings are retained for 30 days by default (configurable up to 90), and you may delete a visitor's recordings at any time.

**Site keys.** A site key identifies your site to Insights and appears in your page source. It is not a secret: it can only send recordings, and only from the domains you list for it. You are responsible for keeping that list accurate.

**Allowance, packs and credits.** Each workspace that installs Insights receives a free monthly allowance of kept recordings; one recording counts once per 2 MiB of compressed data. Above the allowance you may buy prepaid recording packs. Purchased credits expire 12 months after purchase. When your allowance and credits are used up, new recordings are not kept until the allowance resets or you add credits; recordings already kept remain available for their retention period. A refunded pack returns only its unused credits.$terms$,
  'draft',
  NULL,
  now()
FROM legal_documents d
WHERE d.document_type = 'terms'
  AND d.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM legal_document_versions v
    WHERE v.document_type = 'terms' AND v.version = '2.2.0' AND v.change_kind = 'draft'
  )
ORDER BY d.published_at DESC
LIMIT 1;
