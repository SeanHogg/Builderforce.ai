-- Publish the third August 2026 product-update batch.
--
-- EDITORIAL RULE for this table, and for every batch after it: these notes are
-- MARKETING copy, not a changelog of commits. Each one leads with what a person
-- can now do, and the batch as a whole is framed on the product's own method —
-- **Idea to Real**: the arc (Idea → Make → Run → Measure → Market) declared in
-- `frontend/src/lib/navGroups.ts`, and the loop (Read → Prove → Build) declared
-- in `frontend/src/lib/methodology.ts`, whose kill condition is graded in
-- Measure and handed back to Idea. Notes are ordered along that arc so the
-- panel reads as the method rather than as a week of tickets, and engineering
-- work with no customer-visible promise is deliberately left out.
--
-- Content covers everything shipped between 2026-08-16 and 2026-08-22, drawn
-- from DONE.md. The previous batch (0474) was authored on 2026-08-15 and covered
-- the work up to that day, so nothing here repeats a note already on the
-- changelog; where a feature 0474 announced was extended (embedded apps,
-- marketplace Stage, résumé import), the note says what CHANGED.
--
-- Fixed ids make the migration safe to replay, and explicit publication times
-- keep the public changelog in a deterministic order (newest first, in the order
-- listed below). `emailed_at` deliberately remains NULL so the product-updates
-- digest announces this batch exactly once.
--
-- `version` is the release the change is live in: 2026.8.68 for the surfaces a
-- user works on directly, 2026.8.33 for the platform capabilities behind them.
INSERT INTO release_notes (
  id,
  version,
  title,
  body,
  category,
  stage,
  published_at
) VALUES
  -- ── IDEA · What if? ───────────────────────────────────────────────────────
  (
    'a1b2c301-0004-4000-8000-000000000001',
    '2026.8.33',
    'Idea to Real now tells you whether it worked',
    'The method has always been three acts: read the idea, choose the proof worth paying for, build that one. Reading and proving still cost nothing, and the recommendation still opens with the cheapest of the eight proofs rather than the whole system — because the expensive failure is building the right-looking thing before anyone wanted it.

What was missing was the ending. A proof now records a verdict — met, missed or abandoned — with the number that decided it read straight off the console that measured it, and the date you called it. Rebuilding afterwards cannot hide when you decided.

That is what turns the arc into a loop: the kill condition you set in Prove is graded in Measure and handed back to Idea. It is also the one number we hold ourselves to — the share of ideas that reach a proof whose kill condition was actually measured.',
    'new',
    'live',
    '2026-08-22 12:26:00'
  ),
  (
    'a1b2c301-0004-4000-8000-000000000002',
    '2026.8.33',
    'Show me the before',
    'Ask for a redesign of a live website and you used to be told the assistant cannot see web pages. It can now — the real page, as it looks, not just the words on it. So a redesign starts from a before-and-after instead of a description, and the version you are pitching sits on the board next to the one you are replacing.',
    'new',
    'live',
    '2026-08-22 12:25:00'
  ),
  (
    'a1b2c301-0004-4000-8000-000000000003',
    '2026.8.68',
    'A starting point that actually sets something up',
    'Picking a starting point used to hand you a prompt and wish you luck. Now it walks you through what the idea needs to work: connect this account, choose that field, pick a schedule — and the plan is only complete when it really is. One catalogue instead of four, and the scenarios this product supports end to end are in it, from applicant tracking to messaging to dunning.',
    'improvement',
    'live',
    '2026-08-22 12:24:00'
  ),
  -- ── MAKE · Build it. ──────────────────────────────────────────────────────
  (
    'a1b2c301-0004-4000-8000-000000000004',
    '2026.8.68',
    'Run what your board just built',
    'Ask for a product and you get the files, the page and the setup notes. Now you get a Run surface too: everything the assistant wrote assembled into one working application, on the board, with no hunting for a publish button. Desktop, tablet and phone are real device widths, so the three readings differ the way three real machines do — and the code your assistant writes reaches the app every time, which it did not before.',
    'new',
    'live',
    '2026-08-22 12:23:00'
  ),
  (
    'a1b2c301-0004-4000-8000-000000000005',
    '2026.8.68',
    'The canvas gave the screen back to your work',
    'Four bands of chrome are gone. Your board fills the window and everything else floats over it — what this canvas is, how you are reading it, what you can do to it, who is here. Fold the bar away and controls disappear but status never does: a teammate editing beside you, a live connection, a run in progress. And a phone finally gets the five things it never had, sharing, undo and redo among them.',
    'improvement',
    'live',
    '2026-08-22 12:22:00'
  ),
  (
    'a1b2c301-0004-4000-8000-000000000006',
    '2026.8.68',
    'Build a world and walk around in it',
    'A 3D world is now something you make, not just a view of your board: place props, move the camera, walk the scene with real weight and collisions. Games made here actually play — ask for a Roblox game and you get a place you can move around in rather than a design document about one.',
    'new',
    'live',
    '2026-08-22 12:21:00'
  ),
  (
    'a1b2c301-0004-4000-8000-000000000007',
    '2026.8.68',
    'Drop a scan on the board and it reads it',
    'PDFs from Google Docs, Word and Pages now read properly — they used to come back as gibberish and get refused. A page with no text in it at all, a photographed contract, a signed agreement someone scanned: all transcribed and turned into a document you can edit, rather than left as a file icon. It works before you have signed up, too.',
    'improvement',
    'live',
    '2026-08-22 12:20:00'
  ),
  (
    'a1b2c301-0004-4000-8000-000000000008',
    '2026.8.68',
    'Everything on the board is editable, and says what it is',
    'Every one of the 180 things you can put on a board now carries a line explaining what it holds, so choosing between an estimate and a dispatch board is not guesswork. The last 42 object types that had no settings panel have one — real fields, and nothing pretending to be an editor where the object''s own grid or 3D view already is one. Documents open at page size, with readable type and one continuous sheet, instead of a four-line box.',
    'improvement',
    'live',
    '2026-08-22 12:19:00'
  ),
  (
    'a1b2c301-0004-4000-8000-000000000009',
    '2026.8.68',
    'Connections join whichever side you drop on',
    'Dragging from one card and releasing on the right-hand side of the next did nothing — no error, no notice, the line just vanished. Both the canvas and the workflow builder now take a connection from either handle. The "+" no longer sits on top of the connector it was hiding, settings open attached to the card they belong to, and a board you built before signing up can be saved to your account instead of being refused at the door.',
    'fix',
    'live',
    '2026-08-22 12:18:00'
  ),
  -- ── RUN · Run it as a company. ────────────────────────────────────────────
  (
    'a1b2c301-0004-4000-8000-000000000010',
    '2026.8.68',
    'One button turns your board into something people can pay for',
    'Choose the address up front, watch it check availability as you type, press once — and your board is a real project with its own runtime, its own data, its own people and its own web address. Sellers now see their true fee, 0% while under $200,000 of lifetime sales, instead of the default rate the earnings page used to show. Somebody using your app can pay you without a second signup, a form on it raises a ticket on the board that maintains it, and the app pays for its own upkeep out of its own sales.',
    'improvement',
    'live',
    '2026-08-22 12:17:00'
  ),
  (
    'a1b2c301-0004-4000-8000-000000000011',
    '2026.8.33',
    'Stage runs your product instead of reading it',
    'The checks before something goes on sale used to inspect a snapshot. Now they boot it in a disposable sandbox with the outside world cut off, tap it to see whether it really responds, and measure your media for a real duration so a broken asset is caught before a buyer finds it. If you are selling access to something running, we ask that address whether it is up — and refuse the sale if it is not.',
    'improvement',
    'live',
    '2026-08-22 12:16:00'
  ),
  (
    'a1b2c301-0004-4000-8000-000000000012',
    '2026.8.68',
    'Working on it together, live',
    'Your teammates'' pointers move at pointer speed now, not once every eight seconds, and they stay where they belong when you pan or zoom. Starting a call is just something you do to a canvas — the same action on a conversation, a board, a 3D space or a running app — and the call''s bar no longer buries the controls underneath it. When a call cannot connect it says which of three things went wrong instead of "Connecting…" forever.',
    'improvement',
    'live',
    '2026-08-22 12:15:00'
  ),
  (
    'a1b2c301-0004-4000-8000-000000000013',
    '2026.8.33',
    'Work happens when you scheduled it',
    'A nine o''clock report could run half an hour late on a quiet platform. It runs at nine now. A campaign with a send time actually sends — and re-checks its sender, audience and suppression list at the moment it starts, so a permission revoked last week stops the send rather than being discovered one batch in. Campaigns can be SMS as well as email, and an attachment on a message can be opened rather than merely mentioned.',
    'improvement',
    'live',
    '2026-08-22 12:14:00'
  ),
  (
    'a1b2c301-0004-4000-8000-000000000014',
    '2026.8.33',
    'Your runs stop dying on somebody else''s rate limit',
    'On the worst day we measured, 150 of 164 finished runs on one project ended as a provider rate limit. A model that keeps refusing is now benched for longer each time instead of being retried every ninety seconds forever, the provider behind it steps back on the same ladder, and your canvas no longer waits on a model that went quiet mid-answer. Fewer runs die for reasons that have nothing to do with your work.',
    'fix',
    'live',
    '2026-08-22 12:13:00'
  ),
  -- ── MARKET · Sell, buy, hire, be found. ───────────────────────────────────
  (
    'a1b2c301-0004-4000-8000-000000000015',
    '2026.8.68',
    'The board could build anything and sell none of it',
    'Now it sells. A quote one buyer can actually accept, with its own discount, term and expiry. An outreach sequence that runs across channels and stops the moment somebody replies. A call recorded for what came out of it. A time-boxed trial with the activation criteria agreed up front. A trust packet holding the evidence behind every security answer. A mutual action plan whose milestones name an owner on the buyer''s side.

Hand a demo to a prospect who has no account, under your branding, watch-only — and see what they opened, how long they stayed and which cards they kept coming back to.',
    'new',
    'live',
    '2026-08-22 12:12:00'
  ),
  (
    'a1b2c301-0004-4000-8000-000000000016',
    '2026.8.33',
    'Fixed-price work, with the money held until it is delivered',
    'Milestones now have a surface on every side of the deal: you fund, accept, request changes, release or cancel; the person doing the work delivers and watches the same escrow balance you do. A bid can propose its own schedule instead of one number, nobody starts on an unfunded milestone, and the buttons you are offered are always ones that will be honoured.',
    'new',
    'live',
    '2026-08-22 12:11:00'
  ),
  (
    'a1b2c301-0004-4000-8000-000000000017',
    '2026.8.33',
    'The money coming in, not just the money going out',
    'Issue an invoice, record the payment, chase what is late — from the board, with each chase recorded once so the same customer is never chased twice. Ageing is computed from the due date rather than being whatever was last typed on a card, and a pay run records what payroll really cost. Every customer, supplier and counterparty resolves to a real account, so a trailing "Ltd" stops quietly creating a second version of the same company.',
    'new',
    'live',
    '2026-08-22 12:10:00'
  ),
  (
    'a1b2c301-0004-4000-8000-000000000018',
    '2026.8.33',
    'A cap table that survives its second event',
    'Ownership is recorded as what actually happened — the classes your board authorised, the terms of each grant, SAFEs and notes as the different instruments they are, and a full history of issues, transfers, exercises and cancellations. Percentages are arithmetic over that history, not a column that stops adding up the first time you top up a pool or somebody leaves. A round records what you are raising, at what valuation, with whom and by when; what has closed comes from the allocations, so the two can never disagree.',
    'new',
    'live',
    '2026-08-22 12:09:00'
  ),
  (
    'a1b2c301-0004-4000-8000-000000000019',
    '2026.8.33',
    'The paperwork that comes before all the other paperwork',
    'Founders'' agreement, IP assignment, vesting schedule and mutual NDA ship as templates you fill in and send for signature — and a missing field is refused by name rather than rendered as a dash into something somebody then signs. Any legal document can be stored encrypted, shared by link and signed, and a data room can hold the actual files a diligence request asks for instead of only the checklist naming them.',
    'new',
    'live',
    '2026-08-22 12:08:00'
  ),
  (
    'a1b2c301-0004-4000-8000-000000000020',
    '2026.8.33',
    'Hiring that ends with someone on the payroll',
    'An accepted offer becomes an employee and an onboarding plan in one step, carrying the title, location, basis and start date across so nobody retypes them — and it refuses on an unsigned offer, because that is a record of something that did not happen. Every scored résumé is attached to a real candidate. And your own HR system can be read rather than re-entered: Workday, BambooHR, HiBob, Personio, SAP SuccessFactors, Greenhouse or any SCIM directory, read-only by design.',
    'new',
    'live',
    '2026-08-22 12:07:00'
  ),
  (
    'a1b2c301-0004-4000-8000-000000000021',
    '2026.8.33',
    'Fifteen career tools that compute an answer',
    'Score a résumé, compare it to a posting, tailor it, plan the route to a target role, prepare interview questions, audit your profile — fifteen tools, each showing the working behind its number rather than handing down a verdict. With them: a salary guide covering 16 roles across 14 cities, and a reference list that stays private until you share a link.

Everything they produce lands on your board as objects you can connect and reason over, not prose in a document. Saved job alerts finally run, on a schedule, using exactly the rules of the search you were looking at.',
    'new',
    'live',
    '2026-08-22 12:06:00'
  ),
  -- ── MEASURE · Is it working? ──────────────────────────────────────────────
  (
    'a1b2c301-0004-4000-8000-000000000022',
    '2026.8.33',
    'Every number on every seat is a real number',
    'Forty-five figures across seventeen seats were charted and almost none of them had anything producing them — so a founder whose published site was genuinely collecting signups opened the panel and saw nothing. All of them are computed from your own rows now, attributed to the object they came from. The war room is a live room rather than a feed, an audit''s deep pass re-scores its own report, and plans can be dragged to reschedule — on the tablet a review actually happens on, not just a laptop.',
    'improvement',
    'live',
    '2026-08-22 12:05:00'
  ),
  (
    'a1b2c301-0004-4000-8000-000000000023',
    '2026.8.33',
    'What the model may read off your board is a rule now, not a label',
    'Confidential objects used to carry a label that nothing enforced. Every boundary one can cross — what the assistant sees, a share link, an export, a published site — now applies a ceiling, and people records are restricted by default. An imported spreadsheet''s contents no longer ride along in every request, and a dataset''s purpose, lawful basis and retention are checked before it can be exported or used to train anything.',
    'improvement',
    'live',
    '2026-08-22 12:04:00'
  ),
  (
    'a1b2c301-0004-4000-8000-000000000024',
    '2026.8.33',
    'The four questions an AI purchase turns on',
    'Can it read our data, will it leak across tenants, what did that answer cost, and how do we know it is getting better? Evermind now answers all four: one ingestion path for documents, pages, spreadsheets and exported records; retrieval scoped to your tenant that fails closed; cost and trace on every answer; and an evaluation gate a change has to pass before it ships. Enterprise sign-on is live over OpenID Connect, pointed at whichever identity provider you already run.',
    'new',
    'live',
    '2026-08-22 12:03:00'
  ),
  (
    'a1b2c301-0004-4000-8000-000000000025',
    '2026.8.68',
    'Builderforce in your language, everywhere',
    'Dates, times, currencies and every number now read the way your language writes them across the whole product — the panels, the insight views, the money on your board — not only on the screens built for it first. Signing up with Google or Microsoft keeps the language you chose instead of falling back to your computer''s default.',
    'improvement',
    'live',
    '2026-08-22 12:02:00'
  ),
  (
    'a1b2c301-0004-4000-8000-000000000026',
    '2026.8.68',
    'The public pages render before any JavaScript runs',
    'Every page on builderforce.ai was arriving as an empty document, so the home page looked like a login wall to a search engine, a link preview and anyone reviewing the product. The pages now render on the server and say what this is. Two more went with it: article dates showed the previous day to roughly half the world, and an unknown address returned an error instead of a proper not-found page.',
    'fix',
    'live',
    '2026-08-22 12:01:00'
  )
ON CONFLICT (id) DO NOTHING;
