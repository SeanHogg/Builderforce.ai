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
 * Every `canvas_*` tool belongs to EXACTLY ONE of the two sets below.
 *
 *  • {@link GUEST_SAFE_CANVAS_TOOLS} — the tool runs entirely in the visitor's own
 *    browser over their own local document, or reads a PUBLIC unauthenticated API
 *    (`GET /api/tools`, the diagnostics catalog). Safe for anyone.
 *  • {@link ACCOUNT_REQUIRED_CANVAS_TOOLS} — the tool reads or writes a TENANT
 *    resource (a connected mailbox, canonical project PRDs, tenant domain data,
 *    server-side image generation). A guest has no tenant, so these are neither
 *    advertised by the client nor accepted by the gateway.
 *
 * The client filters what it ADVERTISES from this contract; the gateway filters what
 * it ACCEPTS from the same contract. One edit adds a tool to both, and the advertised
 * set can no longer be larger than the executable one.
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
 * Canvas tools that require a signed-in tenant session. Advertising one of these to a
 * guest is what produced the reported failure: the model plans around a capability the
 * request will never carry.
 */
export const ACCOUNT_REQUIRED_CANVAS_TOOLS = [
  // Connected Microsoft 365 / Gmail mailboxes (`/api/mailboxes/*`).
  'canvas_add_inbox',
  'canvas_refresh_inbox',
  'canvas_pin_email',
  // Tenant-scoped Builderforce domain data and canonical project PRDs.
  'canvas_read_domain',
  'canvas_read_project_prds',
  'canvas_create_project_prd',
  // Server-side stock search / image generation.
  'canvas_add_image',
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
export type AccountRequiredCanvasTool = typeof ACCOUNT_REQUIRED_CANVAS_TOOLS[number];

/** Every `canvas_*` tool the Creation Canvas advertises, guest-safe and tenant-only. */
export const CREATION_CANVAS_TOOLS = [
  ...GUEST_SAFE_CANVAS_TOOLS,
  ...ACCOUNT_REQUIRED_CANVAS_TOOLS,
] as const;

/** The complete tool vocabulary an anonymous canvas turn may use — canvas + research. */
export const GUEST_CANVAS_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  ...GUEST_SAFE_CANVAS_TOOLS,
  ...GUEST_RESEARCH_TOOL_NAMES,
]);

const ACCOUNT_REQUIRED_SET: ReadonlySet<string> = new Set<string>(ACCOUNT_REQUIRED_CANVAS_TOOLS);

/** True when this tool needs a signed-in tenant session to do anything at all. */
export function canvasToolRequiresAccount(name: string): boolean {
  return ACCOUNT_REQUIRED_SET.has(name);
}

/** True when an anonymous canvas turn may be given this tool. */
export function isGuestCanvasToolName(name: string): boolean {
  return GUEST_CANVAS_TOOL_NAMES.has(name);
}
