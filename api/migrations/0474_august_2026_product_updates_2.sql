-- Publish the second August 2026 product-update batch.
--
-- Customer-facing summaries of everything shipped between 2026-08-12 and
-- 2026-08-15, drawn from DONE.md. The previous batch (0451) covered the work up
-- to 2026-08-10, so nothing here repeats a note already on the changelog.
--
-- Fixed ids make the migration safe to replay, and explicit publication times
-- keep the public changelog in a deterministic order (newest first, in the order
-- listed below). `emailed_at` deliberately remains NULL so the product-updates
-- digest announces this batch exactly once.
--
-- `version` is the release the feature is live in: 2026.8.23 for the surfaces a
-- user works on directly, 2026.8.15 for the platform capabilities behind them.
INSERT INTO release_notes (
  id,
  version,
  title,
  body,
  category,
  stage,
  published_at
) VALUES
  (
    'a1b2c301-0003-4000-8000-000000000001',
    '2026.8.15',
    'Turn a board into an app your customers can pay for',
    'Any Creation Canvas board can now become a real project in one step, with its own kanban board, agent workforce, tickets, monitoring and web address. Your app can sign its own end users in with a six-digit code and no Builderforce account, and you can charge them a one-off price or a recurring subscription. There is no platform fee at all until your lifetime sales pass $200,000.',
    'new',
    'live',
    '2026-08-15 18:23:00'
  ),
  (
    'a1b2c301-0003-4000-8000-000000000002',
    '2026.8.23',
    'Build real software from the canvas prompt',
    'Ask for an app at the canvas prompt and Builderforce creates the project, writes the files and runs it. Seven build tools let it list, read, search, write and surgically edit code instead of rewriting whole files, and build and runtime errors now travel straight back to the agent, so a broken build gets fixed rather than sitting there silently.',
    'new',
    'live',
    '2026-08-15 18:22:00'
  ),
  (
    'a1b2c301-0003-4000-8000-000000000003',
    '2026.8.15',
    'Every file and every release can be undone',
    'Publishing no longer overwrites the site that was working: each build is kept as its own release and restoring an earlier one is a single click, with the ten most recent kept per site. Every file write is archived as well, so an agent that breaks something can put it back — and the restore is itself archived, so reverting is never a one-way door.',
    'improvement',
    'live',
    '2026-08-15 18:21:00'
  ),
  (
    'a1b2c301-0003-4000-8000-000000000004',
    '2026.8.15',
    'Package your app for iPhone, Android or the home screen',
    'Any web or mobile project can now be packaged as an installable PWA, an Android APK or a signed iOS build — not only games. What ships inside the package is exactly what you previewed, so a phone build is no longer a QR code pointing at a website.',
    'new',
    'live',
    '2026-08-15 18:20:00'
  ),
  (
    'a1b2c301-0003-4000-8000-000000000005',
    '2026.8.23',
    'Edit your app by clicking on it',
    'Point at any element in the live preview and change its text or its styling; Builderforce finds the exact line in your source and edits it there. It needs no change to your build setup and works on projects created long before the feature existed. When a line is ambiguous it refuses rather than editing the wrong element.',
    'new',
    'live',
    '2026-08-15 18:19:00'
  ),
  (
    'a1b2c301-0003-4000-8000-000000000006',
    '2026.8.23',
    'Stage a creation before anyone can buy it',
    'Publishing to the marketplace now has a step in between. Stage a version, see it exactly as a buyer will, and run the pre-sale checks for that kind of creation before anything goes on sale. A staged version cannot be reached from the marketplace, buyers stay pinned to the version they actually paid for, and you can revert a listing to any earlier release without rewriting history.',
    'new',
    'live',
    '2026-08-15 18:18:00'
  ),
  (
    'a1b2c301-0003-4000-8000-000000000007',
    '2026.8.15',
    'Prove an idea before you build it',
    'Idea to Real now offers eight ways to make something real, from a 90-second demo reel or a clickable prototype through to a wizard-of-oz trial, a pilot, a phone line or a fully live system. Builderforce ranks them against your brief and deliberately recommends the cheapest proof that answers the question, so you find out whether anyone wants it before you spend weeks building it.',
    'new',
    'live',
    '2026-08-15 18:17:00'
  ),
  (
    'a1b2c301-0003-4000-8000-000000000008',
    '2026.8.15',
    'Run your backend in your own cloud',
    'Generated backends can now deploy to AWS Lambda, Google Cloud Run or Azure Functions as well as to Builderforce, and each deployment carries your pages and your API together so nothing is left behind. Data residency, an existing cloud agreement and a security review become things you can answer rather than work around.',
    'new',
    'live',
    '2026-08-15 18:16:00'
  ),
  (
    'a1b2c301-0003-4000-8000-000000000009',
    '2026.8.15',
    'Advertising, organic reach and measurement in one place',
    'Connect Google, Meta, LinkedIn, TikTok, X, Reddit, Pinterest and Snapchat advertising alongside GA4, Search Console, Plausible and PostHog, plus six more organic networks and three email platforms. Daily spend and results arrive on your board on their own and are corrected as the networks restate them. Campaigns are created paused and a person approves any spend: agents can read what is running and what it cost, never start it.',
    'new',
    'live',
    '2026-08-15 18:15:00'
  ),
  (
    'a1b2c301-0003-4000-8000-000000000010',
    '2026.8.23',
    'Connect your social accounts from the board',
    'Asking Brain to connect your social accounts now opens the panel and reports which networks are connected and what each one still needs, instead of describing a platform you are already inside. A picture the canvas just generated can be attached to a post directly, and any network that has to be skipped is named along with the reason.',
    'improvement',
    'live',
    '2026-08-15 18:14:00'
  ),
  (
    'a1b2c301-0003-4000-8000-000000000011',
    '2026.8.15',
    'Your board tells you before the deadline, not after',
    'Triggers can now watch dates as well as numbers — contract renewals, invoice and bill due dates, funding round close targets, policy reviews and assignment deadlines — and a nightly sweep evaluates them whether or not anybody has the board open. You are told once when a threshold is crossed, rather than every night until you act.',
    'new',
    'live',
    '2026-08-15 18:13:00'
  ),
  (
    'a1b2c301-0003-4000-8000-000000000012',
    '2026.8.23',
    'Bring your Miro boards across',
    'Connect Miro with a personal token and import a whole board — sticky notes, shapes, cards, frames, images, links and the arrows between them — read all the way to the end, so a workshop board with hundreds of items arrives complete rather than as its first page. Anything Miro does not model is reported instead of quietly dropped, and the Creation Canvas now has a sticky note of its own for the ideas that do not have a shape yet.',
    'improvement',
    'live',
    '2026-08-15 18:12:00'
  ),
  (
    'a1b2c301-0003-4000-8000-000000000013',
    '2026.8.23',
    'One résumé, twelve designs',
    'Upload a PDF or Word résumé and Builderforce reads it directly — no third-party account and no waiting for a parse. Ask for ten versions and it restyles the same document through the template engine in a single step, so no version can invent a job you never had, and every one exports as PDF, Word, HTML or Markdown or shares as a public link an employer can open.',
    'improvement',
    'live',
    '2026-08-15 18:11:00'
  ),
  (
    'a1b2c301-0003-4000-8000-000000000014',
    '2026.8.15',
    'Find work, or fill the role, from one profile',
    'A single profile now says whether you are open to freelance work, a permanent role or both, with target roles, seniority, salary range, work mode and notice period. Thirty-five new tools score and tailor a résumé against a real job description and show the evidence behind every number rather than a verdict, saved jobs and applications share one history, and applying records consent and retention properly on the employer side.',
    'new',
    'live',
    '2026-08-15 18:10:00'
  ),
  (
    'a1b2c301-0003-4000-8000-000000000015',
    '2026.8.23',
    'Money on the board finally adds up',
    'Spreadsheets on the canvas now evaluate formulas — SUM, AVERAGE, IF, NPV, IRR, PMT and thirty more — with dependency-ordered recalculation, so changing churn to 4% and reading the new runway is one edit rather than a second sheet nobody keeps in step. Budgets, forecasts, invoices and bills are canvas objects, amounts written as prose are read as real numbers, burn, revenue, MRR and runway are computed daily from your own figures, and a board pack can be scheduled to send itself.',
    'new',
    'live',
    '2026-08-15 18:09:00'
  ),
  (
    'a1b2c301-0003-4000-8000-000000000016',
    '2026.8.15',
    'Run the work you sell, not just the company',
    'Thirteen new object types cover what a service business actually does: service assets, work orders, visits, dispatch boards, service agreements, estimates, inspections, certifications, inventory, suppliers, purchase orders, shipments and incidents. One vocabulary serves twelve disciplines — field service, trades, property, facilities, clinics, fleets and more — and figures such as a work order cost or a dispatch board utilisation are computed rather than typed.',
    'new',
    'live',
    '2026-08-15 18:08:00'
  ),
  (
    'a1b2c301-0003-4000-8000-000000000017',
    '2026.8.15',
    'The back office a founder actually needs',
    'Customers are now real accounts on the board rather than names matched by spelling, and invoices and supplier bills have proper headers, due dates, ageing and an approval that refuses to let the person who entered a bill approve it. Forms can be published to a public link with genuinely anonymous responses, documents can be sent for signature with the text frozen exactly as it was signed, payroll and tax systems can be read so your burn reflects money that really left, and a new Legal seat covers incorporation, registrations, trademarks and matters.',
    'new',
    'live',
    '2026-08-15 18:07:00'
  ),
  (
    'a1b2c301-0003-4000-8000-000000000018',
    '2026.8.23',
    'Teach a class, and let the gradebook do the maths',
    'Gradebooks, assignments, submissions, cohorts, lectures, polls and curriculum maps now compute their own numbers — means, medians, pass rates, marked counts, lateness, attendance and coverage — from the work sitting beside them on the board. Marks and feedback stay something a person records; only the arithmetic over them is automatic. Courses can launch from your LMS over LTI 1.3 with grades passed back.',
    'new',
    'live',
    '2026-08-15 18:06:00'
  ),
  (
    'a1b2c301-0003-4000-8000-000000000019',
    '2026.8.23',
    'Turn your website into a test suite',
    'Give the canvas a URL and it discovers your routes, writes a test case for each one, and hands you runnable Playwright specs you can download — no account required. Accessibility and performance audits, generated test data including the rows that should be rejected, and a coverage view over what is genuinely proven all sit on the same board.',
    'new',
    'live',
    '2026-08-15 18:05:00'
  ),
  (
    'a1b2c301-0003-4000-8000-000000000020',
    '2026.8.23',
    'Draw a data model and get runnable SQL',
    'Asking for an ERD now produces a validated model rather than a picture. Missing keys, dangling references, repeating groups and unresolved many-to-many relationships are caught, junction tables are created for you, and the result exports as executable CREATE TABLE for Postgres, MySQL, SQLite or BigQuery. Author it from a description, infer it from an uploaded dataset, or reverse-engineer it from a live database you connect.',
    'new',
    'live',
    '2026-08-15 18:04:00'
  ),
  (
    'a1b2c301-0003-4000-8000-000000000021',
    '2026.8.15',
    'Publish your integration to every workspace',
    'Your workspace can now be a publisher. Submit a connector or an MCP server, have it reviewed, and have it installable by other workspaces — where it immediately becomes callable by agents and the workflow builder without anyone needing to know it came from the marketplace. An install records exactly which permissions an admin approved, so a later version can never quietly widen them.',
    'new',
    'live',
    '2026-08-15 18:03:00'
  ),
  (
    'a1b2c301-0003-4000-8000-000000000022',
    '2026.8.23',
    'Start with a conversation, not a blank board',
    'A canvas session can now be read more than one way. Open it as a plain conversation and it stays a conversation, with a live count of what it has already put on the board behind it. Switch to the 3D view to see how the work connects, or open a single object in the runtime that suits it: a page for a document or résumé, a play view for a game, a timeline for a video edit.',
    'improvement',
    'live',
    '2026-08-15 18:02:00'
  ),
  (
    'a1b2c301-0003-4000-8000-000000000023',
    '2026.8.23',
    'The canvas no longer waits forever on a silent provider',
    'If a model provider accepts a request and then goes quiet, the turn now ends after 75 seconds of no activity, routes around the stall, and tells you the provider stopped responding instead of blaming a prompt that was fine. Long answers are never cut short, because the timer resets on every token. Boards carrying several résumés also render considerably faster.',
    'fix',
    'live',
    '2026-08-15 18:01:00'
  )
ON CONFLICT (id) DO NOTHING;
