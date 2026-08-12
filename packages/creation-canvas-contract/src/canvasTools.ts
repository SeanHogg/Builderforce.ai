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
  // The free diagnostics and calculators. `GET /api/tools`, `GET /api/tools/:id` and
  // `POST /api/tools/:id/compute` are unauthenticated by design (they power the
  // marketing surface), so a visitor asking "how mature is our delivery?" gets a real
  // scored object on the board instead of an apology.
  'canvas_list_diagnostics',
  'canvas_add_diagnostic',
  // Returns a STATIC executive use-case contract; its tenant-evidence branch already
  // degrades to `saved_session_required` without a session, so it is safe unauthenticated.
  'canvas_prepare_executive_use_case',
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
export const CANVAS_IMAGE_ACCOUNT_GATE = `${CANVAS_IMAGE_TOOL} needs a free Builderforce account: image search and generation run on the server, not in this browser. The account prompt is now open and the canvas is unchanged. Do BOTH of these in your reply: say in ONE sentence that the picture needs a free account, and then build what this canvas CAN hold right now — the authored plan, the labelled layout, the planting list — with canvas_add_object. Do NOT say that you are unable to generate images, that you cannot see or look things up, or that a tool is technically limited: the only reason is the account, and it is one click away.`;
