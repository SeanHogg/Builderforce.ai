/**
 * The Creation Canvas TOOL VOCABULARY, and the one place its guest boundary is drawn.
 *
 * ── THE DEFECT THIS EXISTS TO STOP ───────────────────────────────────────────────
 * The canvas advertises its `canvas_*` tools to the model from the BROWSER, and the
 * gateway independently re-filters them for an anonymous visitor (a guest token may
 * never reach a tenant resource, and the client is not trusted to enforce that). Those
 * two lists were maintained by hand in two packages and drifted: by 2026-08 the guest
 * canvas advertised 24 canvas tools and the gateway allowed 12.
 *
 * The failure is SILENT. The model is handed a tool list that says `canvas_add_inbox`
 * exists, the gateway deletes it before dispatch, and the model — asked to "connect my
 * email" — has nothing to call, does not error, and returns prose. Measured on the
 * public landing canvas, 2026-08-12 (ui 2026.7.210 / api 2026.7.235): three turns,
 * 27 tools advertised, 12 reaching the model, ZERO tool calls, and the whole session
 * answering "I couldn't prepare any canvas changes from that request."
 *
 * Five of the stripped tools were guest-SAFE and simply missing from the allowlist,
 * including `canvas_read_object` — which the Canvas system prompt names explicitly and
 * instructs the model to call before claiming an object is absent (the same class of
 * defect `api/scripts/check-prompt-tool-names.mjs` exists to catch for builtin tools).
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────────
 * Every `canvas_*` tool belongs to EXACTLY ONE of the three sets below.
 *
 *  • {@link GUEST_SAFE_CANVAS_TOOLS} — the tool runs entirely in the visitor's own
 *    browser over their own local document, or reads a PUBLIC unauthenticated API
 *    (`GET /api/tools`, the diagnostics catalog). Safe for anyone.
 *  • {@link GUEST_GATED_CANVAS_TOOLS} — the tool's WORK needs a tenant, but its
 *    guest behaviour is a defined, browser-local refusal: it opens the account gate
 *    and returns the reason. Advertised and accepted, never dispatched to a tenant.
 *  • {@link ACCOUNT_REQUIRED_CANVAS_TOOLS} — the tool reads or writes a TENANT
 *    resource (a connected mailbox, canonical project PRDs, tenant domain data) and
 *    has nothing meaningful to say without one. A guest has no tenant, so these are
 *    neither advertised by the client nor accepted by the gateway.
 *
 * The client filters what it ADVERTISES from this contract; the gateway filters what
 * it ACCEPTS from the same contract. One edit adds a tool to both, and the advertised
 * set can no longer be larger than the executable one.
 *
 * ── WHY THE THIRD SET EXISTS ─────────────────────────────────────────────────────
 * Stripping a tool is the right answer only when its ABSENCE is self-explanatory. It
 * is the wrong answer for a capability the product genuinely has and the user can
 * unlock in one click, because the model cannot report a tool it was never given —
 * it improvises. Measured on the public landing canvas, 2026-08-12 (ui 2026.7.213):
 * "design me a coniferous landscape at the backyard of <address>". `canvas_add_image`
 * was account-required and therefore absent, so the model fell back to
 * `canvas_add_object` kind "drawing", was refused twice for having no {x,y} points,
 * and told the user "I encountered a technical limitation with the drawing tool" and
 * "I cannot directly view or open a map" — two false statements about the product,
 * on a board where the correct answer ("that needs a free account") was one sentence
 * away. Gating IN the tool keeps the refusal truthful and actionable.
 */

/**
 * Canvas tools an anonymous visitor may be given. Local-document operations plus the
 * public diagnostics catalog.
 */
export const GUEST_SAFE_CANVAS_TOOLS = [
  // Reads over the guest's own in-browser document.
  'canvas_read_snapshot',
  // Named by the system prompt as the check to run before saying an object is missing.
  // Its absence from the guest vocabulary meant the prompt was instructing the model to
  // call a tool the model had not been given.
  'canvas_read_object',
  'canvas_read_document',
  // Pure client-side computation over rows already loaded in the guest's own browser.
  // Without it a guest can only be told placeholder numbers.
  'canvas_query_dataset',
  // Authoring + layout over the local document. The API never executes these; they are
  // descriptions of operations the browser applies to the visitor's own canvas.
  'canvas_add_object',
  'canvas_update_object',
  'canvas_delete_object',
  'canvas_arrange_objects',
  'canvas_set_object_layout',
  'canvas_invoke_object_action',
  'canvas_connect_objects',
  'canvas_update_connection',
  'canvas_delete_connection',
  'canvas_convert_diagram',
  // Lifts one post out of a social feed tile that is ALREADY on this board, in the
  // browser, over the posts that tile is holding — no request, no tenant. Its sibling
  // tools, which do reach `/api/social/*`, are in the gated set below.
  'canvas_pin_social_post',
  // Ranks the résumé objects ALREADY ON THIS BOARD against a posting on this board, in
  // the browser, with no network call — the same deterministic analyzer the résumé
  // builder uses, composed N:1. Guest-safe because it reads nothing but the canvas: a
  // visitor evaluating the product can drop in five CVs and a job ad and watch a real
  // ranking come back with its evidence and its gaps, which is the strongest thing this
  // vocabulary can show without an account.
  'canvas_screen_resumes',
  // Re-renders a résumé that is ALREADY on the board through the built-in template
  // engine — pure function, no network, no tenant — so it is guest-safe on exactly the
  // reasoning `canvas_screen_resumes` is, and for the same person: the visitor most
  // likely to arrive logged out and ask for their CV in five styles is the one out of
  // work. Gating it would leave `canvas_add_object` as the only route, which is the
  // path that spent four minutes retyping the document and produced nothing.
  'canvas_render_resume_variants',
  // The step BEFORE both of those, and guest-safe for the same reason: it reads text
  // the visitor's own browser already extracted from the file they dropped, and runs
  // the deterministic JSON Resume reader over it — no network, no tenant, no model.
  // Gating it would leave a logged-out visitor with their CV on the board and no way
  // to make it a résumé, which is the exact dead end that had the model asking people
  // to paste a document the canvas was already holding.
  'canvas_import_resume',
  // ── Academic imports ─────────────────────────────────────────────────────────
  // Same reasoning as `canvas_import_resume`, for the two document formats the
  // academic set documents but never wired: a deterministic CSV/`.bib`/`.ris` reader
  // over text the visitor's own browser already extracted, writing only to a `cohort`
  // or `bibliography` object already on their own board. No network, no tenant.
  'canvas_import_roster',
  'canvas_import_references',
  // The free diagnostics and calculators. `GET /api/tools`, `GET /api/tools/:id` and
  // `POST /api/tools/:id/compute` are unauthenticated by design (they power the
  // marketing surface), so a visitor asking "how mature is our delivery?" gets a real
  // scored object on the board instead of an apology.
  'canvas_list_diagnostics',
  'canvas_add_diagnostic',
  // Returns a STATIC executive use-case contract; its tenant-evidence branch already
  // degrades to `saved_session_required` without a session, so it is safe unauthenticated.
  'canvas_prepare_executive_use_case',
  // ── Founder objects ──────────────────────────────────────────────────────────
  // Pure client-side computation over `competitor` objects ALREADY on the visitor's own
  // board: it reads their `locations`, projects them, and authors a `map` object plus
  // the coverage gaps. No tenant data and no network — the research that PUT the
  // competitors there is `builtin_web_search`, which a guest already has, so a logged-out
  // founder can complete a geographic market analysis end to end.
  'canvas_map_competitors',
  // Evaluates `trigger` objects against the `liveMetric` objects on the same board. The
  // reading of a live metric may need an account; comparing two numbers that are already
  // in front of the visitor does not, and a guest who authors a threshold by hand should
  // see it fire.
  'canvas_evaluate_triggers',
  // ── Data architecture ────────────────────────────────────────────────────────
  // Every one of these is pure computation over the visitor's OWN board: a model
  // authored in the browser, a join between two datasets already loaded there, a
  // PII scan of rows the visitor uploaded themselves, a contract evaluated against
  // them, a check suite run over them, a metric defined on them, and the lineage
  // graph of the objects in front of them. No tenant, no network.
  //
  // `canvas_create_data_model` is the reason this matters: "create me an ERD" must
  // work for someone evaluating the product, and it ends in real DDL. Gating it
  // would make the model improvise a limitation the product does not have — the
  // exact failure the `canvas_add_image` note above records.
  'canvas_create_data_model',
  'canvas_export_data_model',
  'canvas_join_datasets',
  'canvas_classify_dataset',
  'canvas_set_data_contract',
  'canvas_run_data_quality',
  'canvas_define_metric',
  'canvas_trace_lineage',
  // ── Data science: analysis, model comparison, evaluation, governance ─────────
  // Every one is pure computation over the visitor's OWN board, which is what makes
  // them guest-safe on the same reasoning as the data-architecture set above.
  //
  // `canvas_run_notebook` deserves its own note: it EXECUTES code, which sounds like
  // the least guest-safe thing here and is the opposite. The kernel is a Web Worker
  // with `fetch`, `XMLHttpRequest`, `importScripts` and `WebSocket` deleted from its
  // global scope before any cell compiles, the rows are structured-cloned in, and it
  // is terminated on a hard timeout. A cell can compute and cannot reach the network,
  // the DOM or the session — so it is strictly more contained than a tool that calls
  // an API. Gating it would make "analyse this CSV" require an account, which is the
  // single most common thing a visitor arrives wanting to do.
  'canvas_run_notebook',
  'canvas_compare_runs',
  'canvas_sample_for_labels',
  'canvas_forecast_series',
  // Governance is authored locally and enforced locally. A guest who declares that a
  // dataset may not be used for training should see that refusal honoured.
  'canvas_set_data_use',
  // ── QA ───────────────────────────────────────────────────────────────────────
  // "Create automation tests for my website" is answered ENTIRELY in the visitor's own
  // browser: route discovery is a regex over HTML the model already fetched with
  // `builtin_web_fetch` (guest research), and the Playwright lowering is the pure
  // function in `qa.ts`. Gating these would make the most common QA request in the
  // product reachable only after signing up, and — worse, per the note above — would
  // have the model improvise a limitation instead of writing the tests.
  //
  // The page audit is the same shape as `canvas_add_diagnostic`: scored findings over
  // content the visitor supplied, no tenant and no network of its own.
  'canvas_create_test_plan',
  'canvas_test_coverage',
  'canvas_record_defect',
  'canvas_audit_page',
  'canvas_generate_test_data',
] as const;

/**
 * Canvas tools a guest IS given, and the gateway DOES accept, whose browser-side
 * implementation refuses with the account gate rather than reaching a tenant.
 *
 * The tool never becomes a tenant call on an anonymous board — it opens the sign-up
 * prompt, leaves the canvas untouched, and returns {@link CANVAS_IMAGE_ACCOUNT_GATE}
 * so the model relays a true, actionable reason. That is strictly more capability than
 * absence: an absent tool makes the model invent a limitation, and the invented one is
 * always worse than the real one.
 */
export const GUEST_GATED_CANVAS_TOOLS = [
  // Server-side stock search / image generation. The ONLY route to real pixels, so its
  // absence rewrote every "draw me…" turn into a drawing-tool failure.
  'canvas_add_image',
  // The ONLY route to pixels of a page that ALREADY EXISTS, and the same classification
  // for the same measured reason. Without it, "upgrade my website — show me a before and
  // after" produced an after and an apology: "as a large language model, I don't have the
  // ability to browse the web visually or take screenshots of live websites" (2026-08-19,
  // ui 2026.8.60). That is a fact about a model presented as a fact about the product,
  // which is exactly what an absent tool buys. Gated rather than absent so a visitor
  // hears the true, one-click reason instead.
  'canvas_capture_screenshot',
  // The ONLY route to the text of a SCANNED page, and classified by the failure its
  // absence causes rather than by what it touches. Without it a visitor who drops a
  // photographed contract hears "I can't read scanned documents" — a fact about a model
  // presented as a fact about the product, on a board where the true answer is one
  // click away. It self-gates on a saved session and returns the account gate.
  'canvas_read_attachment',
  // The ONLY route to a playable game. Deliberately here rather than in the safe set
  // even though HALF of it is guest-safe: a web game is authored in the visitor's own
  // browser and needs no account, while a Roblox place is written on the server. The
  // tool self-gates on that split. It is classified by the failure its ABSENCE causes,
  // which is the reason this set exists — without it a guest asking for a game gets
  // `canvas_add_object`, and that produces a design document nobody can play.
  'canvas_add_game',
  // Writes the board's cases into the tenant's QA library (`/api/qa/flows` +
  // `/api/qa/generate`) and reads its runs back. Gated rather than absent for the
  // reason the whole set exists: a visitor who has just watched the canvas write their
  // tests will ask to make them run, and "that needs a free account" is a true,
  // one-click answer, where an absent tool produces an invented one. It is also the
  // only tool a guest-visible description may name — `canvas_create_test_plan`'s
  // description does not, precisely so this classification stays free to change.
  'canvas_publish_tests',
  // Files a board dataset as a fine-tune training corpus under a project. Classified
  // here for the same reason as `canvas_publish_tests`, and by the same test: what does
  // its ABSENCE make the model say? Every step before it is guest-safe — a visitor can
  // import a CSV, profile it, chart it and classify its columns entirely in their own
  // browser — so "now train a model on this" is the natural next sentence on a guest
  // board. With the tool absent the model has no way to know the product fine-tunes at
  // all, and the improvisation it reaches for ("I can't train models") is false about a
  // product that ships adapters. The corpus itself is a tenant row, so the WORK needs an
  // account; the gate is on credentials, not on a saved board, exactly like the social
  // tools. Its description names only `canvas_set_data_use`, which is guest-safe — rule 2
  // holds.
  'canvas_promote_dataset_to_corpus',
  // ── Connected social accounts (`/api/social/*`) ──────────────────────────────
  // Gated rather than absent, for the reason this whole set exists, and on the
  // strongest evidence yet that the reason is real.
  //
  // Measured 2026-08-15 (ui 2026.8.17 / api 2026.8.11), a board opened with "I want to
  // create a social media campaign. First I want to connect all my social media
  // accounts and then create a post that goes to all the social media." All five social
  // tools were account-required and therefore absent, while the SOCIAL block of the
  // canvas system prompt — which is unconditional — was busy naming every one of them.
  // The model, holding instructions for tools it had not been given, improvised: "I
  // can't directly perform those actions. You would need to connect your existing
  // accounts to a social media management platform." That is false twice over. The
  // product connects X, LinkedIn, Facebook, Instagram and TikTok through the connector
  // platform, publishes to all of them from one campaign, and the panel that does it is
  // on the same canvas. It then fell back to `canvas_add_object` kind `socialCampaign`,
  // was refused for carrying no authored ledger, and the session ended with nothing on
  // the board and a recommendation to go and buy a competitor's product.
  //
  // Every one of these is a stateless request carrying the tenant token, exactly like
  // `canvas_add_image` — so the gate is on CREDENTIALS, not on whether the board has
  // been saved, and a signed-in user on an unsaved board publishes for real.
  //
  // `canvas_pin_social_post` is NOT here: it lifts one post out of a feed tile already
  // on the board, in the browser, with no request of its own — so it belongs with the
  // local-document tools above. A guest can never hold a feed tile to pin from, and the
  // answer it gives them ("there is no social feed on this canvas yet") is true.
  'canvas_connect_social_account',
  'canvas_add_social_feed',
  'canvas_refresh_social_feed',
  'canvas_create_social_campaign',
  'canvas_publish_social_campaign',
] as const;

/**
 * Canvas tools that require a signed-in tenant session. Advertising one of these to a
 * guest is what produced the reported failure: the model plans around a capability the
 * request will never carry.
 */
export const ACCOUNT_REQUIRED_CANVAS_TOOLS = [
  // Connected Microsoft 365 / Gmail mailboxes (`/api/mailboxes/*`).
  'canvas_add_inbox',
  'canvas_refresh_inbox',
  'canvas_pin_email',
  // The social tools used to be here. They are guest-GATED now — see the note above
  // them in GUEST_GATED_CANVAS_TOOLS for the session that moved them, and why absence
  // was the worse of the two answers.
  // Tenant-scoped Builderforce domain data and canonical project PRDs.
  'canvas_read_domain',
  'canvas_read_project_prds',
  'canvas_create_project_prd',
  // ── Founder objects, tenant half ─────────────────────────────────────────────
  // Writes the investor seat's `companies` row onto a canvas `company` object. It is a
  // WRITE-TO-BOARD action layered on the same kernel read `canvas_read_domain` performs
  // — the same relationship `canvas_add_diagnostic` has to `GET /api/tools` — not a
  // second way to read a tenant's company.
  'canvas_sync_company_profile',
  // ── Founder operations (0469) ────────────────────────────────────────────────
  // Every one reads or writes a TENANT record, which is what makes them
  // account-required rather than guest-gated: a counterparty register, a CRM's
  // deals, and a stage change that moves a real deal. A guest has none of the
  // three, and unlike an image or a test run there is no true one-sentence answer
  // that turns into a capability on sign-up — an empty workspace has no
  // counterparties either. Advertising them to a guest would spend the model's
  // attention on three routes it cannot take, on the surface where first
  // impressions are formed.
  //
  // `canvas_move_deal` is the one that matters structurally: it writes the deal
  // AND rewrites the board from the same response, which is what replaces the
  // mirroring instruction in the canvas system prompt with a mechanism.
  'canvas_sync_account',
  'canvas_sync_sales_pipeline',
  'canvas_move_deal',
  // The RAISE is the same board through a different family (FO-E1): `deals.kind =
  // 'investment'`, `party_roles role='investor'`, and `pipeline_touchpoints` as the
  // thread. `canvas_open_deal` is the one that makes a firm an OBJECT rather than a
  // string in a cell, which is what `fundingRound.investors` never was.
  'canvas_sync_funding_round',
  // The round's PLAN, as a record. `funding_rounds` had no writer at all until
  // 0937, so a target and a valuation were board JSON beside an empty table.
  'canvas_plan_funding_round',
  'canvas_open_deal',
  'canvas_log_deal_touch',
  // ── The data room, actually sent (FO-E2) ─────────────────────────────────────
  // Account-required for the sharpest version of the reason: sharing one sends
  // diligence material to a named party outside the workspace, behind an NDA, with
  // every open logged. A guest board has no room, no recipient and no NDA.
  'canvas_sync_data_room',
  'canvas_share_data_room',
  'canvas_revoke_data_room_share',
  // A room holds TWO shapes: a diligence obligation and an encrypted legal file
  // filed into it (0937). This is how the second one gets there — and how it leaves.
  'canvas_file_document_in_data_room',
  // The founders' agreement and its siblings, drafted from the one template registry
  // (FO-D5). Account-required because it renders a real workspace's formation
  // paperwork and lands it on a `contract` card that is then SENT for signature.
  'canvas_draft_legal_document',
  // Reads the pay runs a connected payroll provider actually ran, onto a `payRun`
  // card. Account-required for the plainest possible reason: it makes an
  // authenticated call to the tenant's own Gusto, Rippling, ADP or Deel account. A
  // guest board has no payroll — and unlike an image, there is no true
  // one-sentence answer that becomes a capability on sign-up either, because an
  // empty workspace has no payroll provider connected.
  'canvas_sync_pay_run',
  // ── Ownership (0927) ─────────────────────────────────────────────────────────
  // Account-required for the same reason, with one addition that is specific to
  // this family: three of the five WRITE the ledger that says who owns the
  // company. There is no guest-safe reading of "issue shares", and a board with no
  // workspace has no ledger to fold, so advertising them to a visitor would spend
  // the model's attention on five routes it cannot take.
  //
  // `canvas_sync_cap_table` is the one that matters structurally: it replaces a
  // hand-typed `holders` array with a FOLD, which is what makes the percentages
  // total 100 by construction rather than by instruction.
  'canvas_sync_cap_table',
  'canvas_record_equity_grant',
  'canvas_record_convertible',
  'canvas_record_equity_event',
  'canvas_model_round',
  // Re-reads the domain metric series a `liveMetric` object was bound to. This is the
  // LIVE half the finance and investor answers never had: without it every runway, burn
  // and pipeline number on a board is a snapshot with an as-of date and no way to ask
  // again. Named for `liveMetric` rather than the semantic-layer `metric` it must not be
  // confused with — see the kind's note in index.ts.
  'canvas_refresh_live_metric',
  // ── The secure legal FILE (`/api/legal-documents/*`) ─────────────────────────
  //
  // These four and `canvas_request_signature` below were declared by the canvas and named
  // NOWHERE in this contract, because `check-canvas-tool-contract.mjs` scanned three
  // source files and their two modules were not among them — the guard's own "a new family
  // adds one line here" instruction, unfollowed twice. Nothing broke, and that is the
  // point: an unlisted `canvas_*` tool is dropped from a guest turn by
  // `restrictGuestTools`, which is the RIGHT outcome for these, arrived at by accident
  // rather than by decision. They are account-required for the ordinary reason: each one
  // reads or writes an encrypted tenant document, mints an external link to it, or emails
  // a counterparty for a signature. A guest has no document to share.
  'canvas_legal_document_sync',
  'canvas_legal_document_share',
  'canvas_legal_document_revoke_share',
  'canvas_legal_document_request_signature',
  // The generic e-signature request for an AUTHORED object (a contract, an offer) rather
  // than an uploaded file. Same reason: it emails a real counterparty.
  'canvas_request_signature',
  // The RETURN LEG. `canvas_request_signature` wrote "sent" and nothing ever wrote
  // what happened next, so `policy.roster` and `acknowledgementRate` — both declared
  // as "written by the signature subsystem" — had no writer at all. Account-required
  // for the same reason as its sibling: it reads a real tenant record.
  'canvas_sync_signature',
  // ── The sell motion ──────────────────────────────────────────────────────────
  //
  // The commercial half of "idea to real". Every one is account-required, and for a
  // sharper reason than "it reaches a tenant": each acts on a real relationship with a
  // real person outside the workspace. A prospect share mints a credential; an engagement
  // read projects `activity_log`; pricing reads the published contract and writes a figure
  // a buyer will be held to; a trial and a handoff create durable boards; a cadence sends
  // messages to named people. A guest board has no prospect, no cadence and no evidence to
  // assemble, so advertising these to one would spend the model's attention on ten routes
  // it cannot take — the failure this contract's own header measures.
  //
  // There is deliberately no `canvas_accept_quote`. Acceptance exists ONLY on the buyer's
  // own tokenised route, so no seller, agent or model can close a deal on the buyer's
  // behalf — see `canvasSellMotionTools.ts`.
  'canvas_share_with_prospect',
  'canvas_list_prospect_shares',
  'canvas_revoke_prospect_share',
  'canvas_refresh_prospect_engagement',
  'canvas_price_quote',
  'canvas_read_call',
  'canvas_assemble_trust_packet',
  'canvas_provision_trial',
  'canvas_handoff_plan',
  'canvas_enrol_in_sequence',
  'canvas_set_sequence_state',
  // ── Connected data sources (`/api/data-sources/*`) ───────────────────────────
  // The tenant's own connected warehouses — Postgres/Neon, ClickHouse, BigQuery.
  // Account-required for exactly the reason the mailbox tools are: the credential
  // is a tenant credential, and a guest has no warehouse to read. The GUEST path
  // to the same capability is a file upload, which is already complete.
  'canvas_list_data_sources',
  'canvas_add_data_source',
  'canvas_query_data_source',
  // Reads this workspace's fine-tuning runs (`/api/ide/training/*`) — a tenant
  // resource with a tenant credential, so a guest has no runs to read. This is the
  // tool that closes the loop a `build` object of modality "finetune" opens: without
  // it the board launches a training run and can never see the loss curve or the
  // scorecard it produced.
  'canvas_read_training_run',
  // ── The recruiter's funnel (`/api/hiring/*`) ─────────────────────────────────
  // Account-required for the same reason `canvas_read_domain` is: every one reads or
  // writes tenant hiring data. The Recruiter built-in agent ships a good bio and, until
  // these existed, no domain tools at all — so it improvised limitations, which is the
  // failure mode `canvas_add_image` documents at length.
  //
  // `canvas_measure_funnel` is a WRITE-TO-BOARD over the same computation the seat
  // reads, not a second way to count a pipeline. `canvas_offer_interview_slots` mints
  // the candidate's self-schedule link over the availability solver that already
  // existed — the recruiter's largest time sink was never built OUT, only never wired
  // to anyone without an account.
  'canvas_measure_funnel',
  'canvas_offer_interview_slots',
  // ── The build vocabulary (`lib/canvasBuildTools.ts`) ─────────────────────────
  // Creating, listing, reading, searching and editing the CODE behind a Builder
  // object. Account-required for the plainest possible reason: a workspace is
  // tenant storage (`ide/projects/<id>/` in R2, behind a tenant JWT), and a guest
  // has no workspace to write into.
  //
  // These are deliberately NOT guest-gated. The gated set exists for a capability
  // whose absence would make the model invent a limitation — a picture, a test
  // run — where "that needs a free account" is a true one-sentence answer. Here
  // the guest path is not a refusal but a different and complete answer: an
  // anonymous board can already author a `website` object, a `prototype` and a
  // full spec with the tools it has. Advertising seven build tools that every
  // guest call would refuse would spend the model's attention on the one route it
  // cannot take, on the surface where first impressions are formed.
  'canvas_create_build',
  'canvas_list_build_files',
  'canvas_read_build_file',
  'canvas_search_build_files',
  'canvas_write_build_file',
  'canvas_edit_build_file',
  'canvas_read_build_diagnostics',
  // The undo. Same classification for the same reason: a workspace's history is
  // tenant storage, and a guest has no workspace to roll back.
  'canvas_list_build_file_history',
  'canvas_restore_build_file',
] as const;

/**
 * RESEARCH tools a guest canvas may use. They run server-side, but only through the
 * public guest research surface (`/api/guest/research/*`), which takes a signed guest
 * token, charges its own daily allowance, uses the PLATFORM search backing rather than
 * any tenant's key, and fetches behind the same SSRF guard as every other surface.
 *
 * The names MUST match the advertised `builtin_*` names the AUTHENTICATED canvas gets
 * from the MCP catalog, because ONE system prompt names these tools for both surfaces
 * (see the prompt-tool-name contract, `api/scripts/check-prompt-tool-names.mjs`).
 */
export const GUEST_RESEARCH_TOOL_NAMES = [
  'builtin_web_search',
  'builtin_web_fetch',
  'builtin_geo_geocode',
] as const;

/**
 * CAREER tools an anonymous canvas turn may use.
 *
 * ── WHY THESE ARE GUEST-SAFE ─────────────────────────────────────────────────────
 * Every one runs entirely over TEXT THE VISITOR SUPPLIES — the résumé they pasted, the
 * posting they pasted, the numbers they typed. No tenant resource, no network, no clock:
 * the implementations live in `api/src/application/career/*`, which is pure by
 * construction, and the guest route dispatches the exact same functions the signed-in
 * catalog does. There is one implementation, so a logged-out visitor gets the identical
 * scoring a paying tenant gets rather than a degraded imitation of it.
 *
 * ── WHY THIS SET AND NOT A SMALLER ONE ───────────────────────────────────────────
 * The person most likely to arrive logged-out and type their situation into the first
 * box they see is someone out of work. Gating the résumé score behind an account is not
 * a conversion tactic — it is the product having nothing to say to the visitor with the
 * most urgent need, on the surface that is the front door. The tools that DO need an
 * account (applying to a posting, editing a public listing, reading a mailbox) are
 * account-required for the ordinary reason: they write to a tenant, and a guest has none.
 *
 * These names are the `builtin_*` ADVERTISED forms, matching what the authenticated
 * canvas gets from the MCP catalog, for the same reason the research names do: one
 * system prompt drives both surfaces, so a guest-only alias would make the prompt name a
 * tool that is absent from the guest's list — a failure that is silent by construction.
 */
export const GUEST_CAREER_TOOL_NAMES = [
  // Résumé readings — the whole point of the guest surface for this visitor.
  'builtin_recruiter_score_resume',
  'builtin_recruiter_optimize_resume',
  'builtin_recruiter_tailor_resume',
  'builtin_recruiter_match_job',
  'builtin_recruiter_summarize_resume',
  'builtin_recruiter_resume_sentiment',
  'builtin_recruiter_roast_resume',
  'builtin_recruiter_extract_skills',
  'builtin_recruiter_parse_resume',
  'builtin_recruiter_consolidate_resumes',
  // The hiring side of the same pure comparison. A logged-out visitor evaluating the
  // product by pasting a candidate's résumé and their own posting reaches no tenant and
  // no network — it is the identical overlap measurement the seeker half runs, reported
  // to the other party. Withholding it would only mean the model improvises a screening
  // verdict instead of computing one against stated criteria.
  'builtin_recruiter_screen_candidate',
  'builtin_recruiter_build_packet',
  // Preparation and positioning.
  'builtin_recruiter_interview_questions',
  'builtin_hr_coach',
  'builtin_hr_value_proposition',
  'builtin_hr_employer_research',
  // Direction.
  'builtin_hr_career360_suggest_targets',
  'builtin_hr_career360_select_target',
  // Money. `hr_runway` is the number that paces every other decision, and it is pure
  // arithmetic over figures the visitor typed — there is nothing to gate.
  'builtin_hr_salary_analyze',
  'builtin_hr_comp_analyze',
  'builtin_hr_runway',
  'builtin_hr_compare_work_options',
  // Drafting a listing they do not have an account to save yet. Deliberately included:
  // seeing the listing their own résumé produces is the strongest reason to make one.
  'builtin_listing_draft_from_resume',
  'builtin_listing_readiness',
  'builtin_listing_profile_blocks',
] as const;

export type GuestSafeCanvasTool = typeof GUEST_SAFE_CANVAS_TOOLS[number];
export type GuestGatedCanvasTool = typeof GUEST_GATED_CANVAS_TOOLS[number];
export type AccountRequiredCanvasTool = typeof ACCOUNT_REQUIRED_CANVAS_TOOLS[number];

/** Every `canvas_*` tool the Creation Canvas advertises, across all three sets. */
export const CREATION_CANVAS_TOOLS = [
  ...GUEST_SAFE_CANVAS_TOOLS,
  ...GUEST_GATED_CANVAS_TOOLS,
  ...ACCOUNT_REQUIRED_CANVAS_TOOLS,
] as const;

/** The complete tool vocabulary an anonymous canvas turn may use — canvas + research + career. */
export const GUEST_CANVAS_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  ...GUEST_SAFE_CANVAS_TOOLS,
  ...GUEST_GATED_CANVAS_TOOLS,
  ...GUEST_RESEARCH_TOOL_NAMES,
  ...GUEST_CAREER_TOOL_NAMES,
]);

const ACCOUNT_REQUIRED_SET: ReadonlySet<string> = new Set<string>(ACCOUNT_REQUIRED_CANVAS_TOOLS);
const GUEST_GATED_SET: ReadonlySet<string> = new Set<string>(GUEST_GATED_CANVAS_TOOLS);

/** True when this tool needs a signed-in tenant session to do anything at all. */
export function canvasToolRequiresAccount(name: string): boolean {
  return ACCOUNT_REQUIRED_SET.has(name);
}

/** True when this tool is advertised to a guest but answers with the account gate. */
export function canvasToolGatesForGuest(name: string): boolean {
  return GUEST_GATED_SET.has(name);
}

/** True when an anonymous canvas turn may be given this tool. */
export function isGuestCanvasToolName(name: string): boolean {
  return GUEST_CANVAS_TOOL_NAMES.has(name);
}

/**
 * The ONE tool that puts real pixels on the canvas.
 *
 * Named from here by the tool descriptions, the canvas system prompt and both refusals
 * below, so a rename cannot leave the model being pointed at a tool that is not in its
 * list — the `canvas_*` half of the prompt-tool-name contract.
 */
export const CANVAS_IMAGE_TOOL = 'canvas_add_image';

/**
 * Returned to the MODEL when it reaches for an authored vector or chart object to
 * satisfy a request for a real picture.
 *
 * The refusal it replaced said only "a generated drawing must include at least two
 * renderable {x,y} points… or use a chart with chartLabels and chartValues", which is
 * true and useless: neither shape can hold a photograph, so the model read it as the
 * product being unable to make pictures and said so to the user. A refusal has to name
 * the tool that WOULD work.
 */
export function canvasImageToolRedirect(kind: string): string {
  return `A "${kind}" object cannot hold a photograph or a rendered picture, so this would land as an empty card. This is an IMAGE request: call ${CANVAS_IMAGE_TOOL} with mode "generate" to create the picture, or mode "find" to search real photography. Use kind "drawing" only for vector {x,y} points you author yourself, and kind "chart" only for plotted values — never as a stand-in for a picture, and never offer one to the user as if it were one.`;
}

/**
 * The ONE tool that puts a PLAYABLE game on the canvas.
 *
 * Exactly the same problem, and the same answer, as {@link CANVAS_IMAGE_TOOL}. A
 * `game` object created through `canvas_add_object` is a brief with no artifact
 * behind it — generation is a separate step the model does not know to take. So
 * "create a Roblox game" produced an object whose `content` held a four-thousand
 * word design document and whose `outputUrl` was empty: a essay where a game was
 * asked for (operator report 2026-08-17, ui 2026.8.49).
 *
 * This tool generates the artifact and attaches it in the SAME call, so a game
 * object never exists in the unplayable state.
 */
export const CANVAS_GAME_TOOL = 'canvas_add_game';

/** What a generated game is authored FOR. The artifact genuinely differs. */
export const GAME_PLATFORMS = ['web', 'roblox'] as const;
export type GamePlatform = (typeof GAME_PLATFORMS)[number];

export function isGamePlatform(value: unknown): value is GamePlatform {
  return typeof value === 'string' && (GAME_PLATFORMS as readonly string[]).includes(value);
}

/**
 * Returned to the MODEL when it reaches for `canvas_add_object` to satisfy a
 * request for a game.
 *
 * The refusal this replaces was `emptyShellProblem`, which said "send the authored
 * content in fields: content, prompt, mediaKind, …". That is true for most kinds
 * and actively harmful for this one: it names `content` first, so the model wrote
 * PROSE into it and produced a design document that satisfied the gate and played
 * nothing. A refusal has to name the tool that would actually work.
 */
export function canvasGameToolRedirect(): string {
  return `A "game" object created this way is a brief with no game behind it — generating the playable artifact is a separate step, so this lands as an unplayable card and a design document is NOT a game. Call ${CANVAS_GAME_TOOL} instead: it writes the game and attaches it in one call, so it is playable immediately. Use platform "roblox" when the user names Roblox, and platform "web" otherwise — a web game is one self-contained document that also installs on a phone and wraps into an Android or iOS app, so never refuse a phone or app request or route it to a design doc. Do not describe the game in prose instead of building it.`;
}

/**
 * Returned to the MODEL when a game is requested on a canvas with no account.
 *
 * Same rule as the image gate: name the ONE real reason, say what the board still
 * has, and forbid the invented limitation. A guest CAN get a playable web game
 * (it is authored in their own browser), so the gate is Roblox-only — and saying
 * otherwise would be false.
 */
export const CANVAS_GAME_ACCOUNT_GATE = `Authoring a Roblox place needs a free Builderforce account: the Luau and the .rbxlx are written on the server, not in this browser. The account prompt is now open and the canvas is unchanged. Do BOTH of these in your reply: say in ONE sentence that the Roblox build needs a free account, and then offer to build a playable WEB game right now with ${CANVAS_GAME_TOOL} at platform "web" — that works on this board with no account, plays immediately, and installs on a phone. Do NOT say that you cannot make games, and do NOT describe this as a technical limitation: it is the account, and it is one click away.`;

/**
 * Returned to the MODEL when a picture is requested on a canvas with no account behind
 * it. The account prompt is already open by the time the model reads this, so the
 * instruction is what to SAY and what to build instead — not a bare denial.
 */
/**
 * Returned to the MODEL when a guest asks to make their generated tests actually run.
 *
 * Written to the same rule as the image gate: name the ONE real reason, say what the
 * board still has, and forbid the invented limitation. A visitor at this point is
 * holding runnable Playwright source the canvas just wrote for them — telling them
 * the product "cannot run tests" would be false, and telling them nothing at all is
 * what makes a model improvise.
 */
export const CANVAS_QA_ACCOUNT_GATE = `canvas_publish_tests needs a free Builderforce account: the QA library, its personas and its scheduled runs are workspace resources, and this board has no workspace behind it. The account prompt is now open and the canvas is unchanged. Do BOTH of these in your reply: say in ONE sentence that saving the suite and running it on a schedule needs a free account, and then point out what the user ALREADY has — every test case on this board carries complete, runnable Playwright source they can download and run locally right now. Do NOT say that the product cannot run tests, cannot generate specs, or is technically limited: the tests exist, and the only thing behind the account is where they are stored and scheduled.`;

/**
 * Returned to the MODEL when a social tool is called on a canvas with no credentials.
 *
 * Written to the same rule as the image and QA gates, plus one clause neither of them
 * needs: this request has a supported half and an unsupported half, and the model that
 * failed it (2026-08-15, see the note in the gated set) got BOTH wrong in one sentence.
 * CONNECTING an existing X / LinkedIn / Facebook / Instagram / TikTok account is a
 * first-class product capability behind a free account. REGISTERING a brand-new account
 * on those networks is not something this product does, and never will be — that is a
 * true limitation, and the only one here. A gate that does not separate them invites the
 * model to blur them, and blurring them is how a user gets told to go and buy a social
 * media management platform while looking at one.
 */
export const CANVAS_SOCIAL_ACCOUNT_GATE = `Connected social accounts need a free Builderforce account: X, LinkedIn, Facebook Pages, Instagram and TikTok are connected as workspace connections, and this board has no workspace behind it. The account prompt is now open and the canvas is unchanged. Do ALL THREE of these in your reply: say in ONE sentence that connecting the accounts and publishing needs a free account; author the campaign itself on the board right now with canvas_add_object — the copy, the per-network variants, the link and the media brief — so the moment an account is connected there is something to publish; and if the user asked you to REGISTER new accounts on those networks, say plainly that signing up on a social network is something only they can do, and that Builderforce connects the accounts they already have. Do NOT say that you cannot connect social accounts, do NOT suggest a third-party social media management tool, and do NOT describe any of this as a technical limitation: connecting is a built-in capability and it is one click away.`;

/**
 * Returned to the MODEL when a guest asks to fine-tune on a dataset already on the board.
 *
 * Written to the same rule as the QA gate, and for the same shape of turn: everything up
 * to this point worked without an account, so the one sentence the model must not say is
 * that the product cannot train a model. It can. What needs the account is the corpus
 * row and the training run, and the board keeps every bit of preparation either way.
 */
export const CANVAS_CORPUS_ACCOUNT_GATE = `Filing a training corpus needs a free Builderforce account: a corpus is a row under a project and a fine-tune runs on workspace compute, and this board has no workspace behind it. The account prompt is now open and the canvas is unchanged. Do BOTH of these in your reply: say in ONE sentence that saving the corpus and running the fine-tune needs a free account, and then point out what the user ALREADY has on this board — the dataset, its column classifications and its data-use policy are all authored and travel with the canvas, so promoting it is one click after signing up. Do NOT say that the product cannot train, fine-tune, or build adapters on their data, and do NOT describe this as a technical limitation: fine-tuning is a built-in capability and the only thing behind the account is where the corpus lives.`;

/**
 * The ONE tool that puts pixels of a LIVE, EXISTING page on the canvas.
 *
 * Sibling of {@link CANVAS_IMAGE_TOOL} and separate from it on purpose: search and
 * generation answer "make me a picture of X", and no amount of either can answer "show
 * me what MY site looks like right now". A redesign is a claim that one design beats
 * another, and the claim is unreadable without the thing being replaced.
 */
export const CANVAS_SCREENSHOT_TOOL = 'canvas_capture_screenshot';

/**
 * Returned to the MODEL when it is about to tell a user the product cannot see, browse,
 * or photograph a live web page.
 *
 * Written as a redirect rather than a rule in the prompt because the failing turn was
 * not a refused tool call — it was a model that had NO tool and filled the gap with a
 * sentence about its own architecture. The prompt names this tool; this string is what
 * every other refusal path points at, so a rename cannot strand either.
 */
export function canvasScreenshotToolRedirect(): string {
  return `This product CAN photograph a live web page: call ${CANVAS_SCREENSHOT_TOOL} with the page's URL and a real browser renders it server-side. Never tell the user you cannot browse the web visually, cannot see a website, or cannot take screenshots — that is a statement about a language model, not about this canvas, and it is false here. For a redesign, capture the current page FIRST and attach it to the new design with compareWithObjectId, so the board holds a real before and after rather than an after on its own.`;
}

/**
 * Returned to the MODEL when a capture is requested on a canvas with no account.
 *
 * Same rule as every gate above: name the ONE real reason, say what the board still
 * has, and forbid the invented limitation — which for this capability is the specific
 * sentence that made it necessary.
 */
export const CANVAS_SCREENSHOT_ACCOUNT_GATE = `${CANVAS_SCREENSHOT_TOOL} needs a free Builderforce account: the page is rendered by a real browser on the server, not in this tab. The account prompt is now open and the canvas is unchanged. Do BOTH of these in your reply: say in ONE sentence that the "before" screenshot needs a free account, and then build the comparison this board CAN hold right now — read the live page with builtin_web_fetch and set out its current headline, structure and calls to action beside the new design, so the user can see what changed. Do NOT say that you are unable to browse the web visually, that you cannot see or screenshot a website, or that this is a technical limitation of the product: the only reason is the account, and it is one click away.`;

export const CANVAS_IMAGE_ACCOUNT_GATE = `${CANVAS_IMAGE_TOOL} needs a free Builderforce account: image search and generation run on the server, not in this browser. The account prompt is now open and the canvas is unchanged. Do BOTH of these in your reply: say in ONE sentence that the picture needs a free account, and then build what this canvas CAN hold right now — the authored plan, the labelled layout, the planting list — with canvas_add_object. Do NOT say that you are unable to generate images, that you cannot see or look things up, or that a tool is technically limited: the only reason is the account, and it is one click away.`;
