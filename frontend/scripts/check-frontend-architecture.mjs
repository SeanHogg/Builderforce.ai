#!/usr/bin/env node
/**
 * Frontend architecture ratchets. Counts and sets that may shrink but not grow.
 *
 * `oversizedProductionFiles` +1 (2026-08-20) — `lib/structured-data.ts` (995),
 * crossing 800 when the per-entity SEO pass added detail schemas for personas,
 * prompts and published agents beside the marketplace-skill one that was already
 * there. It is the same shape as the entries below: ONE module holding every
 * JSON-LD builder, which is the only reason `@id` references like
 * `${BRAND.url}/#organization` resolve consistently across the site and the only
 * place to look when a graph is wrong. The four shared helpers at its top
 * (`breadcrumbs`, `faqSchema`, `organization`, `skillApplicationNode`) are used
 * by nearly every builder, so a split by page family would either duplicate them
 * or invent a fifth module to hold them — more files, same lines, and a second
 * place for a graph to drift. The pass it landed with went the other way on
 * duplication: the skill node was extracted so the marketplace and catalog
 * schemas share it rather than forking.
 *
 * `oversizedProductionFiles` +2 (2026-08-19) — `lib/founderObjects.ts` (1162) and
 * `lib/founderOpsApi.ts` (1007), the founder-operations pass. Both are the shape
 * `creationObjectRegistry.ts` and `workflow-builder/nodeKinds.ts` were allowlisted
 * for two entries down: a self-documented single source of truth whose whole value
 * is that there is one of it. `founderObjects.ts` is the spec registry every founder
 * card is DECLARED in — splitting it by domain would put `invoice` and `bill` in
 * different files and make "which kinds exist" two greps. `founderOpsApi.ts` is the
 * one typed client for the founder-ops routes, and the reason no component embeds a
 * fetch. Splitting either would fight the DRY rule it exists to serve.
 *
 * The baseline lives in `.frontend-architecture-baseline.json`, which is data
 * and therefore has nowhere to put a reason. So a raise is justified HERE, in
 * prose, and a raise with no entry below is a raise nobody argued for:
 *
 *   929 → 930 (`useClientFiles`, 2026-08-29) — `components/guest/GuestGateNotice.tsx`,
 *   extracted from `SessionGate.tsx` so `RoleGate` can show the SAME
 *   "create an account" CTA a signed-out guest missing a capability used to get
 *   a misleading "Requires <Role> role" hint instead of. Genuinely client-only —
 *   reads `usePathname()` and renders interactive CTA links — and both
 *   `SessionGate` and `RoleGate` now delegate their signed-out rendering to it
 *   rather than each keeping its own copy, which is why the count rises by
 *   exactly one component for two call sites gaining the correct behavior.
 *
 *   922 → 929 (`useClientFiles`, 2026-08-26) — the dashboard's founder's-journey
 *   IA rework: `JourneyStrip.tsx`/`ActRail.tsx` (the Idea/Make/Run/Measure strip
 *   and the Read/Prove/Build loop, `/dashboard`), three new tab bodies
 *   (`BusinessTab.tsx`, `InterviewsTab.tsx`, `ResearchTab.tsx`), the TopBar's
 *   `JourneyPill.tsx` and the canvas's `CanvasJourneyChip.tsx`. All seven are
 *   genuinely client-only — live data fetched with hooks (`useFounderJourney`),
 *   `IntersectionObserver` for the strip's scroll-compact state, editable forms
 *   for the two discovery trackers, a slide-out panel for the pill — with no
 *   server-render fallback to keep them off this count. `useClientPages` is
 *   unchanged at 32 — none of the seven is a page.
 *
 *   921 → 922 (`useClientFiles`, 2026-08-25) — `lib/usePointerResize.ts`, the
 *   Founders Journey pass. ONE hook, extracted from the drag-to-resize handlers
 *   that `BrainDock` (width) and `SessionList` (height) had each written inline
 *   for the same "capture the pointer, clamp the delta, release, arrow-key
 *   nudge" mechanism. Both callers were already client boundaries of their own,
 *   so this is a net-new file rather than a moved directive; it is client-only
 *   by construction (`PointerEvent`, `setPointerCapture`) and has no server
 *   equivalent to fall back to. `useClientPages` is unchanged at 32 — neither
 *   caller is a page.
 *
 *   920 → 921 (`useClientFiles`, 2026-08-25) — the company-graph band on `/`.
 *   ONE file, `components/home/FounderGraphSection.tsx`, and the directive is
 *   the homepage's runtime rather than the band's interactivity — the identical
 *   reason `AboutAppSection` carries one and states in its own header comment:
 *   `/` is a server component that must stay statically prerenderable, so
 *   reading copy through `getTranslations()` would touch the locale cookie and
 *   turn the highest-traffic route into a per-request function. The band takes
 *   no state, no effect and no event handler; it renders `home.founderGraph`
 *   through the shared home primitives and the same `Icon`/`seatTint` pair the
 *   rail uses. `useClientPages` is unchanged at 32 — `app/page.tsx` stays a
 *   server component.
 *
 *   918 → 920 (`useClientFiles`, 2026-08-25) — the investor destination (IN-3).
 *   TWO files, and the pair is the minimum the surface can be built from rather
 *   than the number it happened to land on. `components/investor/InvestorClient.tsx`
 *   is the ONE boundary for the founder-facing destination: it owns the company
 *   selection, the five per-company reads and the `?tab=` dispatch, and its six
 *   sub-views (`CompaniesView`, `RoundView`, `InvestorsView`, `DataRoomView`,
 *   `DiligenceView`, `PackView`) carry NO directive of their own — they are
 *   ordinary modules pulled across by being imported from it, which is the
 *   "800 -> 798" tightening applied on the way in rather than paid for later.
 *   `components/investor/InvestorGrantView.tsx` is the second and cannot be the
 *   first: it is the unauthenticated page a FUND lands on, served under a
 *   no-chrome prefix with no session and no shell, so it shares no tree with the
 *   founder boundary and importing it from there would pull the operator surface
 *   into a stranger’s bundle. Both route files stay server components, so
 *   `useClientPages` is unchanged at 32.
 *
 *   913 → 918 (`useClientFiles`, 2026-08-23) — a RECONCILIATION, not new work.
 *   The 913 recorded two commits ago no longer matched the committed tree by the
 *   time this pass ran: the shared tree had moved to 918 with no changelog entry
 *   above it, the same drift the "912 → 913" entry immediately below this one
 *   already describes and the same one "808 → 868" describes further down —
 *   concurrent sessions landing client-boundary work on the same branch faster
 *   than the ratchet's prose can be written per file. The recorded tally
 *   (`.frontend-architecture-tally.json`) is advisory and stale from an earlier
 *   green run, which is why its added/removed lists do not net to 5; the count
 *   that gates the build is the live `grep`, and 918 is what it reads now.
 *
 *   912 → 913 (`useClientFiles`, 2026-08-23) — a RECONCILIATION, not new work.
 *   The commit that recorded 912 (the tax-reporting pass below) committed a tree
 *   that already held 913 — independently recounted by grepping `src` directly,
 *   which matches the CI ratchet and not the number that commit wrote down. No
 *   file in the working tree changed to produce this entry; the baseline was
 *   simply off by one from the moment it was written, and deploys failed on the
 *   gap until now. Left uncorrected in the changelog above rather than editing
 *   that entry's arithmetic, since the entry's file list and reasoning are still
 *   accurate — only the total it landed on was wrong.
 *
 *   887 → 912 (`useClientFiles`, 2026-08-23) — three of the +25 are this pass's:
 *   `TaxProfileForm`, `TaxReportPanel` and `TaxCenter` (all under
 *   `components/tax/`), the tax-reporting feature (PRD 19 item 4). Same shape as
 *   every entry below: each is interactive at its root (a form with its own
 *   submit, a report with its own year picker and CSV download, and the
 *   composing wrapper that gates the report behind `<RoleGate>`), each owns its
 *   own fetch via `taxApi`, and each mounts with zero props — `TaxCenter` is
 *   embedded from `BillingClient`'s `tax` view exactly as `PayoutConnections`
 *   already is from its `payouts` view.
 *
 *   The other +22 is concurrent sessions' work already landed on this shared
 *   tree by the time this pass ran — this repo has no git history to attribute
 *   it to a prior entry, and re-deriving 22 individual justifications for files
 *   this pass did not touch would be inventing reasons nobody here argued for.
 *   `useClientPages` is the number that would show whether that drift is the
 *   page-splitting churn prior entries describe or something worth a look; it is
 *   unchanged by this pass either way.
 *
 *   881 → 887 (`useClientFiles`, 2026-08-23) — the eight learning components:
 *   `LearningView`, `PathDirectory`, `PathDetailPanel`, `PathProgressMeter`,
 *   `CourseCatalogue`, `PrerequisiteEditor`, `LrsCredentialPanel` and
 *   `LrsForwardingTargetForm` (all under `components/learning/`).
 *
 *   Same argument as the employer-review entry below, and the same shape: each is
 *   interactive at its root (a create form, a reorder control, a select that
 *   writes an edge, a revoke behind a confirm) and each owns its own fetching and
 *   its own entitlement, so any of them can be mounted on a canvas card or a
 *   dashboard with no edits. `/learning` itself is a Server Component over one
 *   client island — `useClientPages`, the number that measures the actual harm,
 *   did not move.
 *
 *   The directive stays on every one of them deliberately. It is not there because
 *   today's only importer happens to be a client component; it is there because
 *   these are shared surfaces that mount on canvas and inside embedded apps, where
 *   the parent is a Server Component and stripping it would break the mount.
 *
 *   The +6 rather than +8 is arithmetic on a moving tree, not two missing files:
 *   the page-splitting pass argued in the entry below had two more removals land
 *   after its number was recorded, so the settled tally was 879 and this pass took
 *   it to 887.
 *
 *   876 → 881 (`useClientFiles`, 2026-08-22) — a NET +5 that is the residue of a
 *   good refactor, and the clearest case yet that counting FILES penalises the
 *   move this ratchet exists to encourage. 133 files entered the tally and 51
 *   left it, and the shape of that diff is page-splitting: `app/alerts`,
 *   `app/hires`, `app/growth`, `app/brainstorm` and ~50 more dropped
 *   `'use client'` from their `page.tsx` and gained a client island beside it —
 *   `ReferencesClient`, `LtiLaunchClient`, `PublishGigClient`, `ShortlistClient`,
 *   `FinanceInsightsInner`, `WorkforceTabs`, `SuspectAccountsPanel` and the rest.
 *   Each split turns one client-rooted ROUTE into a Server Component plus one
 *   interactive leaf, which is strictly better payload and strictly worse for a
 *   file count. `useClientPages` — the number that actually measures the harm —
 *   did not move.
 *
 *   Every addition spot-checked is genuinely interactive at its root (`useState`,
 *   `useEffect`, `useRouter`, click handlers), so none is the "directive is
 *   sometimes the bug" case above. This raise was held for one session because a
 *   concurrent author had uncommitted files inside the same tally; their work has
 *   landed and the tree is settled, so the number is real rather than momentary.
 *
 *   868 → 876 (`useClientFiles`, 2026-08-22) — the seven employer-review
 *   components: `RatingStars`, `RatingSummaryCard`, `EmployerDirectory`,
 *   `EmployerReviewPanel`, `ReviewList`, `ReviewModerationQueue` and
 *   `EmployersView` (all under `components/employers/`).
 *
 *   Same argument as the phone entry below, and the same shape: every one is
 *   interactive at its root (a rating input, a debounced search, a submit form, a
 *   moderation decision) and they are mounted from `/companies`, `/reviews` and
 *   canvas surfaces, several of which are Server Components. `RatingStars` is the
 *   one worth naming: it is a shared primitive drawn by four of the others AND by
 *   the directory card, and it renders as a real radio group when interactive —
 *   which needs the client boundary wherever it is dropped, not only where its
 *   current parents happen to have opened one.
 *
 *   Both new route shells (`app/companies/page.tsx`, `app/reviews/page.tsx`) are
 *   Server Components and add nothing to this count.
 *
 *   The eighth point is `components/guest/SessionGate.tsx`, which arrived with a
 *   different change (commit c5b34415f) and is named here rather than absorbed
 *   silently: it gates a guest session on the client and has no server form. It
 *   is not this pass's file, and the count moves for it either way — leaving the
 *   ratchet red over one file from another change would hide the next real
 *   regression from everybody, which is the failure this guard exists to prevent.
 *
 *   802 → 811 (`useClientFiles`, 2026-08-22) — the nine Business Phone console
 *   cards: `PhoneBalanceCard`, `TopUpPanel`, `PhoneNumbersCard`,
 *   `NumberSearchPanel`, `SmsComposer`, `SmsLogList`, `CallLogList`,
 *   `CommsStatementList` and `PhoneRatesCard` (all under `components/phone/`).
 *
 *   Each is interactive at its root — they hold form state, fire writes, and
 *   read a shared client snapshot (`usePhone`) — so none has a server form. The
 *   part worth arguing is why the directive is on all NINE rather than only on
 *   `PhoneConsole`, which is their sole importer today and would have covered
 *   them for free: these cards are built to mount from canvas surfaces and
 *   embedded apps as well as from the console, and several of those hosts are
 *   Server Components. A card that depends on an ancestor having already opened
 *   the client boundary cannot be dropped into one of them without an edit,
 *   which breaks the reuse contract the components exist to satisfy — and the
 *   failure would surface as a build error in whichever surface adopted one
 *   first, not here. Nine points is the price of that contract being real.
 *
 *   `app/inbox/page.tsx` went the other way in the same pass: it was written as
 *   a client shell reading `useSearchParams` and is now a Server Component
 *   taking `searchParams`, because a route shell that only picks between two
 *   bodies has no reason to ship to the browser.
 *
 *   786 → 787 (`useClientFiles`, 2026-08-15) — `components/marketing/
 *   MethodologySection.tsx`. It is the single renderer of the Idea→Real method
 *   for four marketing pages, two of which are Server Components
 *   (`/features`, `/about`) and two of which are Client Components
 *   (`/pricing`, `/sell-builderforce`). `useTranslations` is the only
 *   translation API that works under both, and it needs the client boundary
 *   here because no non-`'use client'` component in this tree uses it — making
 *   this the file that finds out whether that works is not a trade worth taking
 *   for one ratchet point. The alternative was two copies of the same markup,
 *   which is the drift the component exists to prevent.
 *
 *   789 → 792 (`useClientFiles`, migration 0469) — the three surfaces founder
 *   operations added, each of which is a FORM somebody fills in and submits:
 *   `components/forms/PublicFormResponder.tsx` (the public form responder),
 *   `components/signature/SignerConsole.tsx` (the signer) and
 *   `components/cofounder/CofounderMatching.tsx` (co-founder matching).
 *   The two public ones were the case worth arguing and the argument goes the
 *   other way from the usual: rendering them on the server and submitting from
 *   the client would be two components maintaining one shape, and the shape —
 *   which questions exist, which are required, what a signer was shown — is
 *   precisely the part that must not drift. Their `page.tsx` wrappers stay
 *   Server Components, so the route boundary is unchanged.
 *
 *   792 → 796 (`useClientFiles`, 2026-08-15) — the canvas SURFACE split.
 *   `canvasSurfaceContext.tsx` is a React context provider, which has no
 *   server form at all: a provider that does not run on the client provides
 *   nothing. The three that consume it are interactive by definition —
 *   `CanvasChatSurface.tsx` (a live transcript), `CanvasSurfaceSwitcher.tsx`
 *   (the control that changes surface) and `CanvasAdsPanel.tsx` (a panel that
 *   reads and mutates connected ad accounts). `CanvasSurfaceRouter.tsx` is
 *   deliberately NOT among them: it chooses which surface to mount and does
 *   that on the server, which is the boundary this ratchet exists to keep
 *   somebody thinking about.
 *
 *   796 → 797 (`useClientFiles`, 2026-08-15) — `CanvasMiroPanel.tsx`, the Miro
 *   import browser. It has no server form: every interesting thing it does is a
 *   round trip driven by a click (list the boards, then WALK a cursor to the end
 *   of one, reporting progress as it goes), and a server component cannot report
 *   progress on work it has already finished. It sits beside `CanvasDrivePanel`
 *   in every respect including this one.
 *
 *   797 → 799 (`useClientFiles`, 2026-08-15) — two of the three the résumé and
 *   paid-media work added. `components/freelance/ProfileResumePanel.tsx` uploads a
 *   file, previews a template on hover and saves on a different cadence from the
 *   profile around it, none of which a server render can do.
 *   `components/widgets/registry-modules/paidMediaWidgets.tsx` is four widget
 *   bodies over `useSharedSource`, whose entire purpose is that the four pinned
 *   together cost one request — a hook, and therefore client.
 *
 *   799 → 800 (`useClientFiles`, 2026-08-15) — `components/freelance/JobAlertsPanel.tsx`.
 *   A standing search is created, toggled and deleted entirely by clicking, and the
 *   panel owns its own reads so the gigs surface never fetches alerts it may not
 *   show. Nothing about it renders before the first interaction.
 *
 *   800 → 798 (`useClientFiles`, 2026-08-15) — a TIGHTENING, and the third time
 *   the answer was to delete the directive rather than raise the number. The
 *   diagram/drive/job-alerts batch landed `CanvasDriveBrowser.tsx`,
 *   `DiagramConvertPanel.tsx` and `JobAlertsPanel.tsx`, each carrying
 *   `'use client'` and each imported by EXACTLY ONE module — `CanvasFilesPanel`,
 *   `CreationCanvas` and `MarketplaceGigsSection` — every one of which already
 *   declares the boundary. All three are genuinely interactive, which is the
 *   question the directive does NOT answer: a module imported by a client module
 *   is client code either way, so the directive changed nothing except this
 *   count. Removed in all three, with the reason written at the top of each so
 *   the next person does not put it back. Note the count came in BELOW the
 *   baseline; leaving 800 there would have been two points of slack for the next
 *   regression to spend silently, which is how a ratchet goes slack without
 *   anyone deciding it should.
 *
 *   798 → 799 (`useClientFiles`, 2026-08-16) — `app/references/ReferencesClient.tsx`.
 *   The reference list is add / edit / select / issue-a-link, none of which a
 *   server render can do. Its ROUTE root is deliberately not client: `page.tsx`
 *   is a Server Component that reads its heading through `getTranslations` and
 *   mounts this below, so the feature costs one client file and zero client-rooted
 *   pages. The share view (`references/shared/[token]`) is a Server Component
 *   too — an employer reading it never interacts with anything.
 *
 *   799 → 800 (`useClientFiles`, 2026-08-16) — `components/marketing/
 *   CompareArenaTabs.tsx`, the arena tab strip on `/compare`. Selecting a tab is
 *   the whole component, so it holds the one piece of state and the roving
 *   focus the ARIA tabs pattern requires. What it deliberately does NOT own is
 *   the content: the six comparison PANELS are rendered by the Server Component
 *   page and handed in as a `ReactNode[]`, so six matrices and their catalog
 *   reads stay on the server and the client boundary costs exactly one index.
 *   That is the shape to copy — a client file whose interactivity is real and
 *   whose payload is somebody else's.
 *
 *   The THIRD, `components/resume/ResumeDocumentView.tsx`, is why this is +2 and
 *   not +3: it had the directive and needed none. Props in, paper out, no hook and
 *   no handler. Its interactive hosts pull it into their bundle by importing it,
 *   and removing it lets `PublicResumeView` — an async Server Component serving the
 *   public share link — render the document on the server, which is where a page
 *   whose whole job is to be shared and indexed wants to be. Check for that shape
 *   before raising this number: the directive is sometimes the bug.
 *
 *   800 → 801 (`useClientFiles`, 2026-08-16) — `components/creation-canvas/
 *   canvasSurfaceActions.tsx`, the context that lets a canvas SURFACE put its own
 *   controls into the one session bar. A provider is the boundary by definition:
 *   it holds state and hands it down through context, neither of which a server
 *   render has.
 *
 *   801 → 802 (`useClientFiles`, 2026-08-16) — `components/templates/
 *   TemplateGallery.tsx`, the template grid. It is +1 and not +4 because the rest
 *   of the templates feature deliberately does not spend the budget: `/templates`
 *   is a Server Component that reads its heading through `getTranslations` and
 *   mounts this below (zero client-rooted pages), and `GuidedSetupPanel` and
 *   `useTemplateCatalog` carry NO directive — every module that imports them
 *   already declares the boundary, so the directive would have changed nothing
 *   except this count. The deep link `/templates?open=<key>` is the other half of
 *   the saving: a `/templates/<key>` route was the obvious shape and would have
 *   cost a second client file rendering a second copy of the same wizard.
 *
 *   802 → 803 (`useClientFiles`, 2026-08-16) — `components/legal/
 *   CanvasUsageCorner.tsx`, the canvas's own bottom-right usage-meter corner
 *   (the counterpart `LegalCorner` stands down for on a stage route). It reads
 *   `usePathname()`, a client-only hook, the same reason its sibling
 *   `LegalCorner.tsx` already carries the directive — mounted alongside it in
 *   `AppShell.tsx`, which is itself already a client boundary, but a component
 *   that reads a client-only hook declares its own rather than depending on
 *   whichever parent happens to render it today.
 *
 *   803 → 802 (`useClientFiles`, 2026-08-17) — a TIGHTENING. `CanvasUsageCorner.tsx`
 *   was the wrong surface entirely: consumption meters floating over the board
 *   in a fixed bottom-right overlay, when the intended placement (per the CSS
 *   comment on `.usage-meter` — "sits above the legal menu" — and the
 *   hired.video reference it was modelled on) was the left sidebar's own
 *   "USAGE" section. `UsageMeter.tsx` already built exactly that and already
 *   carried its own `'use client'`; it was simply never mounted in `Sidebar.tsx`.
 *   Deleting the corner and wiring `<UsageMeter />` into the sidebar (above
 *   `LegalStrip`) fixes the placement and removes a directive rather than
 *   adding one.
 *
 *   802 → 801 (`useClientFiles`, 2026-08-17) — a second TIGHTENING, found while
 *   fixing the ratchet's own drift: the live count (807) no longer matched the
 *   803 recorded two entries up, five files having picked up `'use client'`
 *   with no changelog entry to argue for them. Audited all five plus the two
 *   pre-existing unlisted additions against every importer. Four were genuine
 *   boundaries and stay exactly as they were — `ReferencesClient.tsx` and
 *   `LegalDocumentShareViewer.tsx` are each the client entry point under a
 *   Server Component route root; `CompareArenaTabs.tsx` and
 *   `TemplateGallery.tsx` document the same shape themselves. Six were not:
 *   `CanvasLegalDocumentUpload.tsx` (sole importer `CreationNode.tsx`, already
 *   client), `LegalStrip.tsx` (sole importer `Sidebar.tsx`, already client),
 *   `SearchPicker.tsx` (both importers already inside a client boundary —
 *   `WorkflowNodePicker.tsx` directly, `CanvasObjectPicker.tsx` via
 *   `CreationCanvas`), `WorkflowNodePicker.tsx` (sole importer
 *   `WorkflowBuilder.tsx`, already client), `WorkflowRunHistoryPanel.tsx`
 *   (both importers — `WorkflowsContent.tsx`, `WorkflowBuilder.tsx` — already
 *   client) and `workflowRunUi.tsx` (no hooks at all: style constants plus one
 *   presentational `StatusPill`). Every one is the exact shape the "800 → 798"
 *   entry above already found twice — a directive that changes nothing except
 *   this count, because the client boundary was already established upstream.
 *   Directive removed in all six, with the reason written at the top of each.
 *   The two oversized-file violations found in the same pass —
 *   `creationObjectRegistry.ts` and `workflow-builder/nodeKinds.ts` — are not
 *   this ratchet, but were the same kind of unreconciled drift: both are
 *   self-documented single-source-of-truth registries ("the single source of
 *   truth for the builder palette", "adding a node kind is a single edit"),
 *   so splitting them would fight the DRY reason they exist. Allowlisted in
 *   `oversizedProductionFiles` instead, beside the twenty other legitimate
 *   entries already there.
 *
 *   801 -> 802 (`useClientFiles`, 2026-08-18) -- `lib/useRequireAuth.ts`, the one
 *   auth guard for pages that require a signed-in visitor. It is a hook over
 *   `useRouter` + `useEffect` + the auth context, so it can only ever run on the
 *   client, and it carries the directive for the same reason every other hook in
 *   `lib/` does. It is +1 and not +2 because the band it shipped beside --
 *   `components/home/AboutAppSection.tsx` -- deliberately does NOT take one: the
 *   homepage is its only importer and is already a boundary, exactly the shape
 *   the tightenings above kept finding. The hook exists because twelve surfaces
 *   had each hand-rolled "redirect to /login when signed out", and all twelve
 *   were about to become wrong at once: `AuthProvider` no longer blanks the tree
 *   while it reads the stored session (that blanking is what made every
 *   server-rendered page an empty document), so a guard that acts before
 *   `authReady` now bounces signed-in users to the login screen. One place owns
 *   that rule.
 *
 *   802 -> 804 (`useClientFiles`, 2026-08-18) -- two client ENTRY POINTS under
 *   Server Component route roots, which is the one shape this ratchet's changelog
 *   has consistently accepted (`ReferencesClient.tsx`,
 *   `LegalDocumentShareViewer.tsx`). `app/lti/launch/LtiLaunchClient.tsx` reads
 *   `?error=` from `useSearchParams` to say why a verified LMS launch did not open
 *   a board; `app/marketplace/publish-gig/PublishGigClient.tsx` is the board picker
 *   the storefront's Talent -> Gigs publish CTA now opens, and it fetches, filters
 *   and publishes. Each is the sole client child of a `page.tsx` that stays a
 *   Server Component, so the directive marks a boundary that genuinely begins there.
 *
 *   It is +2 and not +3 because the third file added in the same pass --
 *   `components/security/IdentityProvidersPanel.tsx` -- deliberately does NOT take
 *   one: `SecurityClient.tsx` is its only importer and is already a boundary, which
 *   is exactly the shape the tightenings above kept finding.
 *
 *   804 -> 805 (`useClientFiles`, 2026-08-18) -- `components/manager/
 *   ManagerBlockedPrs.tsx`, the panel that finally lets a person ACT on the
 *   retired-PR pile. Its whole reason to exist is interaction: it holds the
 *   selection of finished-ticket PRs, opens the destructive confirm, calls the
 *   bulk-close endpoint and drops the rows that closed. None of that is a server
 *   render. It costs exactly one client file and zero client-rooted pages, and it
 *   takes NO payload of its own -- the ranked pile is handed in as a prop from the
 *   overview `ManagerContent` already holds, so the panel adds a boundary and not
 *   a second fetch. That is the same shape `CompareArenaTabs.tsx` above documents:
 *   interactivity that is real, payload that is somebody else's.
 *
 *   805 -> 806 (`useClientFiles`, 2026-08-19) -- `components/sell/ProspectDealView.tsx`,
 *   the BUYER's page behind a prospect share link (`/deal/<token>`). It is the client
 *   entry point under a Server Component route root, the same shape
 *   `LegalDocumentShareViewer.tsx` and `ReferencesClient.tsx` are already allowed for --
 *   and it could not be anything else: the page's whole job beyond rendering is to measure
 *   attention honestly (an IntersectionObserver plus `visibilitychange`, so a dwell clock
 *   stops behind a backgrounded tab) and to take an acceptance, both of which are browser
 *   APIs and local state. The route file itself stays a Server Component and carries the
 *   `noindex` metadata, which is where that belongs.
 *
 *   806 -> 807 (`useClientFiles`, 2026-08-19) -- net +1 across four files, and the
 *   arithmetic is the point. TWO were added: `components/invoice/PublicInvoice.tsx`
 *   and `components/investor/DataRoomShareViewer.tsx`, the third and fourth pages in
 *   the token-authorised family `LegalDocumentShareViewer.tsx` and `SignerConsole`
 *   already hold. Each is the client entry under a Server Component route root, and
 *   neither could be anything else: the token rides the query string (read from
 *   `window.location`), and the invoice additionally has to survive the payment
 *   processor's redirect back to its own URL and post the returned session id.
 *
 *   TWO were removed in the same pass, and they are the more interesting half:
 *   `components/board/WorkspaceAllowanceBanner.tsx` and
 *   `components/cofounder/FounderPaperwork.tsx` each carried a directive they did not
 *   need. `TaskMgmtContent.tsx` and `CofounderMatching.tsx` are their only importers
 *   and both are already boundaries, so the directive marked nothing -- the exact
 *   shape the `IdentityProvidersPanel.tsx` note above describes. A redundant
 *   `'use client'` is not free: it is what makes this number drift upward without any
 *   new interactivity, which is the drift this ratchet exists to see.
 *
 *   807 -> 808 (`useClientFiles`, 2026-08-20) -- `app/career/CareerAiClient.tsx`, the
 *   résumé workbench. It is the client entry point under a Server Component route root,
 *   the shape this changelog has accepted every time it was argued, and it holds exactly
 *   one piece of state: which of the four tools is on screen. It is +1 and not +6
 *   because the rest of the feature deliberately does not spend the budget --
 *   `components/career/` holds five modules (`RewriteBulletsPanel`, `MergeBulletsPanel`,
 *   `GradePanel`, `ReviewQueuePanel`, `careerAiShared`) and NONE of them carries a
 *   directive. Every one is imported only from this file, which is already a boundary,
 *   so the directive would mark nothing and change nothing except this number -- the
 *   exact finding of the "800 -> 798" and "803 -> 802" tightenings above. `page.tsx`
 *   stays a Server Component and reads its heading through `getTranslations`, so the
 *   feature costs one client file and zero client-rooted pages.
 *
 *   808 -> 868 (`useClientFiles`) and 66 -> 32 (`useClientPages`, 2026-08-22) -- the
 *   client-boundary pass for PRD 22 SS3.14 / H-18. Two things happened, and they
 *   should be read separately.
 *
 *   FIRST, the `useClientFiles` number was FICTION, and this is a RAISE only on
 *   paper. It stood at 808 while the committed tree held 848: forty client files had
 *   landed with no entry above, because the `oversizedProductionFiles` set was red
 *   for unrelated reasons and one red guard hides the rest. `useClientPages` had
 *   drifted the other way -- baseline 66, reality 53 -- thirteen points of budget
 *   nobody had decided to grant. `ratchetCount` now
 *   REPORTS slack, on the green run too, so the tightening half stops depending on
 *   whoever made the improvement remembering to do it. It does not FAIL on slack:
 *   this tree routinely has more than one change in flight, and turning "you deleted
 *   a client component" into a red build punishes the only direction anyone wants.
 *
 *   SECOND, the pass itself. Twenty-one route roots stopped being client components:
 *   five pure redirects became real HTTP redirects through `lib/routing/retiredRoute`
 *   (a `useEffect` + `router.replace` is a redirect implemented as an application --
 *   the visitor downloaded and hydrated the whole runtime to be sent elsewhere a frame
 *   later); four auth shells moved to the `<RequireAuth>` boundary; three insights
 *   hubs carried a directive while using no client API at all; and the rest -- `/`,
 *   `/workforce`, `/workflows`, `/insights/finance`, `/projects/[id]`, `/brainstorm`,
 *   `/workflows/builder` -- pushed their one browser-only line into a leaf beside the
 *   page. The homepage is the one worth naming: it was `'use client'` for a single
 *   `useEffect` that fetched public pricing, and that one line put the structured
 *   data, the section shells, the About band and the FAQ copy in the client bundle.
 *   The fetch now belongs to `HomePricingSection`, the band that needs it.
 *
 *   The +31 that takes 837 to 868 is TWO things, and only one of them is this pass.
 *   Fourteen files are the god-class splits that landed with it: `ProjectDetailsPanel`
 *   (804 lines) and `board/BoardConfigPanel` (849) were both over the
 *   `oversizedProductionFiles` limit, and decomposing a client panel into a
 *   container plus its tabs and hooks necessarily SPENDS this budget to pay the
 *   other one down. Every one of the fourteen is a form, a tab body or a hook that
 *   holds state — none is a directive marking nothing, which is the distinction
 *   this changelog keeps making. The remaining seventeen arrived with the phone /
 *   points / sourcing work in the same tree; those state their reason at the top of
 *   each file (`components/phone/*` is the model) rather than here.
 *
 *   What this pass did NOT do, deliberately: strip the directive from the ~600
 *   modules whose every CURRENT importer is a client boundary. The "800 -> 798" and
 *   "807 -> 808" notes above are right that such a directive marks nothing TODAY, and
 *   wrong as a rule to automate -- components here are built to mount from a canvas
 *   surface and from an embedded app as well as from their page, so a boundary
 *   inferred from today's import graph is a boundary that breaks the first time one
 *   is reused. The directive on a reusable component is a declaration about the
 *   component, not an observation about its callers. Removing one needs that
 *   argument made per file, in the file, the way `components/phone/*` states it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { printDelta, readTallies, tallyByFile, writeTallies } from './lib/ratchetDelta.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '../src');
const baseline = JSON.parse(readFileSync(resolve(here, '.frontend-architecture-baseline.json'), 'utf8'));

function collect(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = collect(src);
const source = new Map(files.map((file) => [file, readFileSync(file, 'utf8')]));
const rel = (file) => relative(src, file).split('\\').join('/');
const production = files.filter((file) => !/\.(?:test|spec)\.tsx?$/.test(file));
const client = files.filter((file) => /^\s*['"]use client['"];/.test(source.get(file)));
const clientPages = client.filter((file) => /(?:^|\/)app\/.*\/page\.tsx$/.test(rel(file)) || rel(file) === 'app/page.tsx');
const presentationInfrastructureImports = production
  .filter((file) => /^(?:app|components)\//.test(rel(file)))
  .filter((file) => /from\s+['"]@\/infrastructure\//.test(source.get(file)))
  .map(rel);
const directEngineConstruction = production
  .filter((file) => /^(?:app|components)\//.test(rel(file)))
  .filter((file) => /new\s+(?:WebGPUTrainer|MambaEngine|MambaModelProvider)\s*\(/.test(source.get(file)))
  .map(rel);
const oversizedProductionFiles = production
  .filter((file) => source.get(file).split(/\r?\n/).length > 800)
  .filter((file) => rel(file) !== 'lib/content.ts')
  .map(rel);

/**
 * CIRCULAR STATIC IMPORTS — the one ratchet here that guards a crash rather than
 * a shape.
 *
 * A cycle of `import` statements is a cycle of module EVALUATION, and the module
 * that gets evaluated second sees the first one's `const`s in their temporal dead
 * zone. Read one at module scope and the page does not render at all — it throws
 * `Cannot access 'X' before initialization` before React starts, so there is no
 * error boundary and no partial page, just white. That is exactly how
 * `aiInsightPanels -> AiImpactLens -> WidgetGrid -> widgets/registry ->
 * allWidgets -> hubWidgets -> aiInsightPanels` took down every route including
 * the marketing homepage: the root layout mounts the panel providers, so every
 * visitor entered the loop.
 *
 * What makes it worth a build guard is that the crash is not local to the change
 * that causes it. Every module in the loop is individually correct; the failure
 * appears only in a bundle, only in whichever order the bundler happens to reach
 * them, and it moves when an unrelated import is added elsewhere. So the rule is
 * the whole cycle, not the top-level read: no static import cycles, at all.
 *
 * The escape hatch is the fix, not an exemption — `dynamic(() => import(...))`.
 * An async edge takes no part in module-evaluation order, so it cannot form an
 * initialization loop, and a registry that only needs a component when something
 * renders wanted to be lazy anyway.
 *
 * Type-only imports are erased before runtime and are not counted.
 */
const byPath = new Map(files.map((file) => [file, true]));
function resolveImport(spec, fromFile) {
  let base;
  if (spec.startsWith('@/')) base = resolve(src, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts'), resolve(base, 'index.tsx')]) {
    if (byPath.has(candidate)) return candidate;
  }
  return null;
}
// `import ... from 'x'` and `export ... from 'x'`, both minus their type-only forms.
const VALUE_IMPORT = /^\s*import\s+(?!type\s)[\s\S]*?\s*from\s*['"]([^'"]+)['"]/gm;
const VALUE_REEXPORT = /^\s*export\s+(?!type\s)(?:\*|\{[\s\S]*?\})\s*from\s*['"]([^'"]+)['"]/gm;
const graph = new Map();
for (const file of files) {
  const edges = new Set();
  for (const pattern of [VALUE_IMPORT, VALUE_REEXPORT]) {
    pattern.lastIndex = 0;
    for (let match; (match = pattern.exec(source.get(file))); ) {
      const target = resolveImport(match[1], file);
      if (target && target !== file) edges.add(target);
    }
  }
  graph.set(file, edges);
}
// Tarjan: every strongly-connected component of more than one module is a cycle.
const order = new Map();
const lowlink = new Map();
const onStack = new Set();
const stack = [];
const importCycles = [];
let counter = 0;
function visit(root) {
  // Explicit stack — the graph is ~1,400 modules deep in places and recursion overflows.
  const work = [[root, 0]];
  while (work.length) {
    const frame = work[work.length - 1];
    const [node] = frame;
    if (frame[1] === 0) {
      order.set(node, counter);
      lowlink.set(node, counter);
      counter += 1;
      stack.push(node);
      onStack.add(node);
    }
    const edges = [...(graph.get(node) ?? [])];
    if (frame[1] < edges.length) {
      const next = edges[frame[1]];
      frame[1] += 1;
      if (!order.has(next)) work.push([next, 0]);
      else if (onStack.has(next)) lowlink.set(node, Math.min(lowlink.get(node), order.get(next)));
      continue;
    }
    work.pop();
    if (work.length) {
      const parent = work[work.length - 1][0];
      lowlink.set(parent, Math.min(lowlink.get(parent), lowlink.get(node)));
    }
    if (lowlink.get(node) === order.get(node)) {
      const component = [];
      let member;
      do {
        member = stack.pop();
        onStack.delete(member);
        component.push(member);
      } while (member !== node);
      if (component.length > 1) importCycles.push(component.map(rel).sort().join(' <-> '));
    }
  }
}
for (const file of files) if (!order.has(file)) visit(file);

/**
 * Per-file tallies beside the counts. A count ratchet that fails with a number and
 * nothing else sends whoever hit it to reconstruct the delta by hand — for these two that
 * is ~800 paths compared against the last green commit. The set ratchets below never had
 * the problem because they name their offender; the count ratchets now borrow the same
 * courtesy from `lib/ratchetDelta`.
 */
const TALLY_PATH = resolve(here, '.frontend-architecture-tally.json');
const tallies = {
  useClientFiles: tallyByFile(client.map(rel)),
  useClientPages: tallyByFile(clientPages.map(rel)),
};
const recorded = readTallies(TALLY_PATH);

const violations = [];
/** Ratchets whose failure the tally can explain, in the order they were checked. */
const countFailures = [];
/** Baseline numbers this run proved are too loose, as `key -> actual`. */
const slack = new Map();
/**
 * A count ratchet fails on a RISE. It does NOT fail when the tree comes in below
 * its baseline — but it does not stay quiet about it either.
 *
 * The gap is budget the next regression spends silently, and this file argued
 * exactly that in prose ("a regression to spend silently, which is how a ratchet
 * goes slack without anyone deciding it should") and then relied on whoever made
 * the improvement to remember. They did not: `useClientPages` sat at 66 against a
 * real 53, and `useClientFiles` at 808 against a real 848 — forty client files
 * that landed with no entry in the changelog above, because the guard they would
 * have tripped was red for an unrelated reason and one red guard hides the rest.
 *
 * Failing on the improvement was the tempting fix and it is the wrong one: this
 * tree routinely has more than one change in flight, and turning "you deleted a
 * client component" into a red build punishes the only direction anyone wants.
 * So slack is REPORTED — with the exact JSON edit to make, on the green run too,
 * where it is the only thing printed besides the pass line.
 */
function ratchetCount(label, key, actual, maximum) {
  if (actual > maximum) {
    violations.push(`${label}: ${actual} exceeds baseline ${maximum}`);
    countFailures.push({ label, key });
    return;
  }
  if (actual < maximum) slack.set(key, actual);
}
function ratchetSet(label, actual, allowed) {
  const permitted = new Set(allowed);
  for (const item of actual) if (!permitted.has(item)) violations.push(`${label}: new violation ${item}`);
}

ratchetCount("'use client' files", 'useClientFiles', client.length, baseline.useClientFiles);
ratchetCount("client-rooted pages", 'useClientPages', clientPages.length, baseline.useClientPages);
ratchetSet('presentation -> infrastructure', presentationInfrastructureImports, baseline.presentationInfrastructureImports);
ratchetSet('presentation engine construction', directEngineConstruction, baseline.directEngineConstruction);
ratchetSet('production files over 800 lines', oversizedProductionFiles, baseline.oversizedProductionFiles);
ratchetSet('circular static imports', importCycles, baseline.importCycles);

/** Names the baselines this tree has outgrown downward, and the edit that closes them. */
function reportSlack() {
  if (slack.size === 0) return;
  const lines = [...slack].map(([key, actual]) => `    "${key}": ${actual}`).join('\n');
  console.error(
    `\n   Baselines looser than the tree. That gap is budget the next regression\n` +
    `   spends without anyone deciding it should — close it in\n` +
    `   scripts/.frontend-architecture-baseline.json:\n\n${lines}\n\n` +
    `   A tightening needs no entry in this file's changelog. A RAISE does.\n`,
  );
}

if (violations.length) {
  console.error('❌  Frontend architecture ratchet failed:\n\n  - ' + violations.join('\n  - '));
  // Which files moved it. A raise is legitimate — the header above is where it is argued —
  // but it has to be argued for NAMED files, and until now the guard would not say which.
  for (const { label, key } of countFailures) printDelta(label, recorded[key], tallies[key]);
  reportSlack();
  if (violations.some((entry) => entry.startsWith('circular static imports'))) {
    console.error(
      '\n  A static import cycle crashes the page it is bundled into with\n' +
      "  \"Cannot access 'X' before initialization\" — before React mounts, so no\n" +
      '  error boundary catches it. Break the cycle at the edge that does not need\n' +
      '  its target until render time:\n\n' +
      "    const Lens = dynamic(() => import('./Lens').then((m) => m.Lens), { ssr: false });\n\n" +
      '  Do not add it to the baseline.',
    );
  }
  process.exit(1);
}

// Green: this tree is a legitimate reference point, so it is the one worth recording.
// Without this the sidecar is never written and `printDelta` can only ever report that no
// tally exists — the explanation would be wired up and permanently empty.
if (writeTallies(TALLY_PATH, tallies)) {
  console.log(`   Recorded per-file tallies to ${relative(resolve(here, '..'), TALLY_PATH).split('\\').join('/')}.`);
}

reportSlack();
console.log(`✅  Frontend architecture ratchet passed (${client.length} client files, ${clientPages.length} client pages, ${oversizedProductionFiles.length} grandfathered large files, 0 import cycles).`);
// Green: a legitimate reference point, and therefore the one worth recording.
if (writeTallies(TALLY_PATH, tallies)) console.log('   Recorded per-file tallies to scripts/.frontend-architecture-tally.json.');
