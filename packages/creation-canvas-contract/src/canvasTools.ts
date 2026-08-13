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
  'canvas_convert_to_drawio',
  // Ranks the résumé objects ALREADY ON THIS BOARD against a posting on this board, in
  // the browser, with no network call — the same deterministic analyzer the résumé
  // builder uses, composed N:1. Guest-safe because it reads nothing but the canvas: a
  // visitor evaluating the product can drop in five CVs and a job ad and watch a real
  // ranking come back with its evidence and its gaps, which is the strongest thing this
  // vocabulary can show without an account.
  'canvas_screen_resumes',
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
  // Writes the board's cases into the tenant's QA library (`/api/qa/flows` +
  // `/api/qa/generate`) and reads its runs back. Gated rather than absent for the
  // reason the whole set exists: a visitor who has just watched the canvas write their
  // tests will ask to make them run, and "that needs a free account" is a true,
  // one-click answer, where an absent tool produces an invented one. It is also the
  // only tool a guest-visible description may name — `canvas_create_test_plan`'s
  // description does not, precisely so this classification stays free to change.
  'canvas_publish_tests',
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
  // Connected social accounts (`/api/social/*`) — the tenant's own X / LinkedIn /
  // Facebook / Instagram / TikTok connections, the feed they publish, and the
  // campaigns that publish to them. Publishing is manager-gated server-side; these
  // are account-required for the same reason the mailbox tools are — a guest has no
  // tenant and therefore no accounts to read or post to.
  'canvas_add_social_feed',
  'canvas_refresh_social_feed',
  'canvas_pin_social_post',
  'canvas_create_social_campaign',
  'canvas_publish_social_campaign',
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
  // Re-reads the domain metric series a `liveMetric` object was bound to. This is the
  // LIVE half the finance and investor answers never had: without it every runway, burn
  // and pipeline number on a board is a snapshot with an as-of date and no way to ask
  // again. Named for `liveMetric` rather than the semantic-layer `metric` it must not be
  // confused with — see the kind's note in index.ts.
  'canvas_refresh_live_metric',
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

export type GuestSafeCanvasTool = typeof GUEST_SAFE_CANVAS_TOOLS[number];
export type GuestGatedCanvasTool = typeof GUEST_GATED_CANVAS_TOOLS[number];
export type AccountRequiredCanvasTool = typeof ACCOUNT_REQUIRED_CANVAS_TOOLS[number];

/** Every `canvas_*` tool the Creation Canvas advertises, across all three sets. */
export const CREATION_CANVAS_TOOLS = [
  ...GUEST_SAFE_CANVAS_TOOLS,
  ...GUEST_GATED_CANVAS_TOOLS,
  ...ACCOUNT_REQUIRED_CANVAS_TOOLS,
] as const;

/** The complete tool vocabulary an anonymous canvas turn may use — canvas + research. */
export const GUEST_CANVAS_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  ...GUEST_SAFE_CANVAS_TOOLS,
  ...GUEST_GATED_CANVAS_TOOLS,
  ...GUEST_RESEARCH_TOOL_NAMES,
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

export const CANVAS_IMAGE_ACCOUNT_GATE = `${CANVAS_IMAGE_TOOL} needs a free Builderforce account: image search and generation run on the server, not in this browser. The account prompt is now open and the canvas is unchanged. Do BOTH of these in your reply: say in ONE sentence that the picture needs a free account, and then build what this canvas CAN hold right now — the authored plan, the labelled layout, the planting list — with canvas_add_object. Do NOT say that you are unable to generate images, that you cannot see or look things up, or that a tool is technically limited: the only reason is the account, and it is one click away.`;
