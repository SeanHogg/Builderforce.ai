/**
 * THE third-party canvas-widget contract.
 *
 * A widget is somebody else's code, rendered on somebody's board, inside our page.
 * That sentence contains every reason this file exists: three parties, two trust
 * boundaries, and a rectangle that looks exactly like the rest of the canvas.
 *
 * ── WHY A CONTRACT AND NOT A CONVENTION ──────────────────────────────────────────
 * The obvious way to ship widgets is to render an `<iframe>`, listen for `message`,
 * and switch on `event.data.type`. That works on the first widget and is a
 * cross-origin RCE by the third: `window.message` is a global bus, every frame on
 * the page can post to every other, and a handler that trusts `data.type` trusts
 * whoever shouted loudest. So the three decisions that keep a widget contained are
 * written HERE, once, as data:
 *
 *   1. **The sandbox.** {@link CANVAS_WIDGET_SANDBOX} never contains
 *      `allow-same-origin`. A frame granted both `allow-scripts` and
 *      `allow-same-origin` against a document it can reach shares that document's
 *      origin — same cookies, same storage, same DOM — which is not a sandbox, it
 *      is an inline script with extra steps. This mirrors the rule the canvas play
 *      frame already follows for generated games.
 *   2. **The allowlist.** A message whose `type` is not in
 *      {@link WIDGET_TO_HOST_MESSAGE_TYPES} is dropped without being parsed. An
 *      allowlist and a `default:` case are not the same thing: the switch grows a
 *      new branch every time somebody adds a feature and nobody re-reads it.
 *   3. **The permission.** Every inbound type names the permission it requires
 *      ({@link WIDGET_MESSAGE_PERMISSION}), and the grant is the manifest the admin
 *      approved at registration — not a flag the widget sends about itself.
 *
 * ── WHY IT IS A PACKAGE ──────────────────────────────────────────────────────────
 * The server decides what a widget MAY do (registration, permission grants, the
 * item writes a `board:write` widget is allowed to make through `/api/v1`); the
 * browser decides what a widget's message DOES. Those are the same allowlist read
 * from two runtimes, and two copies of an allowlist is one copy that stops being
 * updated. Source-only, aliased by both tsconfigs, exactly like
 * `@builderforce/creation-canvas-contract`.
 */

/** Bumped when the envelope or the allowlist changes shape. A widget declares the
 *  version it speaks; the host refuses a mismatch rather than guessing. */
export const CANVAS_WIDGET_PROTOCOL_VERSION = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Sandbox
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The `sandbox` attribute every widget frame is rendered with.
 *
 * `allow-same-origin` is ABSENT and must stay absent. With `allow-scripts` also
 * present, the pair hands the frame our own origin whenever the entry document is
 * served from it — and a widget author who wants "just a little" same-origin
 * access is describing a widget that should be an extension instead.
 *
 * `allow-popups-to-escape-sandbox` is present so a widget's "open docs" link lands
 * in a normal tab rather than a second sandboxed window that silently cannot log
 * the user in — the escape applies to the NEW browsing context, never this one.
 */
export const CANVAS_WIDGET_SANDBOX = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox';

/** The `allow` (Permissions-Policy) attribute for the frame. Deliberately empty:
 *  a widget gets no camera, microphone, geolocation or payment by default, and
 *  there is no manifest field that turns them on in v1. */
export const CANVAS_WIDGET_ALLOW = '';

/** The `referrerpolicy` the frame is rendered with — a third party learns that a
 *  Builderforce page embedded it, never WHICH board. */
export const CANVAS_WIDGET_REFERRER_POLICY = 'origin';

// ─────────────────────────────────────────────────────────────────────────────
// Permissions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What a widget may ask for, and therefore what an admin approves once at
 * registration. Deliberately coarse: a permission a person cannot hold in their
 * head while clicking "install" is a permission they grant blind.
 */
export const CANVAS_WIDGET_PERMISSIONS = [
  /** Read the board's title, id and viewport. */
  'board:read',
  /** Read the objects on the board. */
  'item:read',
  /** Create, update and delete objects on the board. */
  'item:write',
  /** Read the display name + avatar of the signed-in user. NEVER the email. */
  'user:read',
  /** Read and write this widget's own per-board key/value blob. */
  'storage:read',
  'storage:write',
  /** Raise a toast on the host surface. */
  'notify',
] as const;

export type CanvasWidgetPermission = (typeof CANVAS_WIDGET_PERMISSIONS)[number];

export function isCanvasWidgetPermission(value: unknown): value is CanvasWidgetPermission {
  return typeof value === 'string' && (CANVAS_WIDGET_PERMISSIONS as readonly string[]).includes(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// Message-type allowlists
// ─────────────────────────────────────────────────────────────────────────────

/** widget → host. Anything not on this list is dropped before it is parsed. */
export const WIDGET_TO_HOST_MESSAGE_TYPES = [
  'widget.ready',
  'widget.resize',
  'widget.getBoard',
  'widget.getItems',
  'widget.createItem',
  'widget.updateItem',
  'widget.deleteItem',
  'widget.getUser',
  'widget.getStorage',
  'widget.setStorage',
  'widget.notify',
  'widget.close',
] as const;

export type WidgetToHostMessageType = (typeof WIDGET_TO_HOST_MESSAGE_TYPES)[number];

/** host → widget. The host only ever sends these four; a widget that receives
 *  anything else on this channel is being spoken to by something that is not us. */
export const HOST_TO_WIDGET_MESSAGE_TYPES = [
  'host.init',
  'host.result',
  'host.error',
  'host.boardChanged',
] as const;

export type HostToWidgetMessageType = (typeof HOST_TO_WIDGET_MESSAGE_TYPES)[number];

export function isWidgetToHostMessageType(value: unknown): value is WidgetToHostMessageType {
  return typeof value === 'string' && (WIDGET_TO_HOST_MESSAGE_TYPES as readonly string[]).includes(value);
}

export function isHostToWidgetMessageType(value: unknown): value is HostToWidgetMessageType {
  return typeof value === 'string' && (HOST_TO_WIDGET_MESSAGE_TYPES as readonly string[]).includes(value);
}

/**
 * The permission each inbound type requires, or `null` for the three that need
 * none — `widget.ready` is the handshake, `widget.resize` sizes the frame the host
 * already owns, and `widget.close` asks to be removed.
 *
 * A `Record` keyed by the union rather than a `Map` or a switch: the type checker
 * then refuses a new message type that forgot to declare its permission, which is
 * the failure this table exists to make impossible.
 */
export const WIDGET_MESSAGE_PERMISSION: Record<WidgetToHostMessageType, CanvasWidgetPermission | null> = {
  'widget.ready': null,
  'widget.resize': null,
  'widget.close': null,
  'widget.getBoard': 'board:read',
  'widget.getItems': 'item:read',
  'widget.createItem': 'item:write',
  'widget.updateItem': 'item:write',
  'widget.deleteItem': 'item:write',
  'widget.getUser': 'user:read',
  'widget.getStorage': 'storage:read',
  'widget.setStorage': 'storage:write',
  'widget.notify': 'notify',
};

// ─────────────────────────────────────────────────────────────────────────────
// The envelope
// ─────────────────────────────────────────────────────────────────────────────

export interface WidgetToHostMessage {
  /** Always `'bfwidget'`. A discriminator, so the host ignores every other
   *  library's `postMessage` traffic without decoding it. */
  channel: 'bfwidget';
  protocol: number;
  type: WidgetToHostMessageType;
  /** Correlates a `host.result` / `host.error` back to the request. */
  requestId?: string;
  payload?: unknown;
}

export interface HostToWidgetMessage {
  channel: 'bfwidget';
  protocol: number;
  type: HostToWidgetMessageType;
  requestId?: string;
  payload?: unknown;
}

export const WIDGET_CHANNEL = 'bfwidget';

/** Why a message was refused. Returned rather than thrown: a hostile frame can
 *  post thousands a second and an exception per message is the denial of service. */
export type WidgetMessageRejection =
  | 'not-our-channel'
  | 'protocol-mismatch'
  | 'unknown-type'
  | 'untrusted-origin'
  | 'permission-denied';

export type WidgetMessageVerdict =
  | { ok: true; message: WidgetToHostMessage }
  | { ok: false; reason: WidgetMessageRejection };

export interface WidgetMessageContext {
  /** `event.origin`, verbatim. */
  origin: string;
  /** The origin the registered manifest's entry URL resolves to. */
  expectedOrigin: string;
  /** The permissions the manifest was REGISTERED with — never what the frame claims. */
  granted: readonly string[];
}

/**
 * The one gate every inbound widget message goes through.
 *
 * Ordered cheapest-first and most-decisive-first, and the order is the point: the
 * channel check throws away the page's ordinary `postMessage` noise without a
 * single property access, and the ORIGIN check runs before the type is trusted so
 * a frame that is not the registered widget cannot even probe which types exist.
 */
export function parseWidgetMessage(raw: unknown, ctx: WidgetMessageContext): WidgetMessageVerdict {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not-our-channel' };
  const candidate = raw as Partial<WidgetToHostMessage>;
  if (candidate.channel !== WIDGET_CHANNEL) return { ok: false, reason: 'not-our-channel' };

  // `event.origin` is the only property of a message event the sender cannot
  // forge, so it is the only one worth checking first.
  if (!ctx.expectedOrigin || ctx.origin !== ctx.expectedOrigin) {
    return { ok: false, reason: 'untrusted-origin' };
  }
  if (candidate.protocol !== CANVAS_WIDGET_PROTOCOL_VERSION) {
    return { ok: false, reason: 'protocol-mismatch' };
  }
  if (!isWidgetToHostMessageType(candidate.type)) {
    return { ok: false, reason: 'unknown-type' };
  }

  const required = WIDGET_MESSAGE_PERMISSION[candidate.type];
  if (required && !ctx.granted.includes(required)) {
    return { ok: false, reason: 'permission-denied' };
  }

  return {
    ok: true,
    message: {
      channel: WIDGET_CHANNEL,
      protocol: CANVAS_WIDGET_PROTOCOL_VERSION,
      type: candidate.type,
      requestId: typeof candidate.requestId === 'string' ? candidate.requestId.slice(0, 128) : undefined,
      payload: candidate.payload,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The manifest
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What a third party registers. The server stores exactly this, plus the origin it
 * derived from `entryUrl` — derived, never supplied, because an origin a caller
 * declares about its own URL is an origin it can lie about.
 */
export interface CanvasWidgetManifest {
  /** Stable, caller-chosen id, unique within the registering workspace. */
  key: string;
  name: string;
  description: string | null;
  /** Absolute https URL the frame loads. */
  entryUrl: string;
  /** Derived from `entryUrl`. The ONLY origin the host will accept messages from. */
  entryOrigin: string;
  iconUrl: string | null;
  permissions: CanvasWidgetPermission[];
  version: string;
  /** Default frame size in board units; the widget may request a resize. */
  width: number;
  height: number;
}

export type ManifestVerdict =
  | { ok: true; manifest: CanvasWidgetManifest }
  | { ok: false; error: string };

const KEY_RE = /^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/;
const VERSION_RE = /^[0-9]{1,4}(\.[0-9]{1,4}){0,2}([-+][0-9A-Za-z.-]{1,16})?$/;

/**
 * The origin a widget's entry URL resolves to, or null if the URL may not be
 * embedded at all.
 *
 * `https` only, with a single exception for loopback so a widget author can
 * develop against `http://localhost:5173` without registering a tunnel. A plain
 * `http` origin on the public internet is a widget whose code an attacker on the
 * path can replace, inside a frame our page is holding open.
 */
export function widgetEntryOrigin(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol === 'https:') return url.origin;
  if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return url.origin;
  return null;
}

/** Validate an untrusted manifest body. Every failure names the field, because a
 *  registration endpoint that answers "invalid manifest" makes the integrator
 *  guess, and guessing integrators file support tickets instead of shipping. */
export function validateWidgetManifest(raw: unknown): ManifestVerdict {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'A manifest object is required' };
  const input = raw as Record<string, unknown>;

  const key = typeof input.key === 'string' ? input.key.trim().toLowerCase() : '';
  if (!KEY_RE.test(key)) {
    return { ok: false, error: 'key must be 3–64 chars of lowercase letters, digits, dot, dash or underscore' };
  }

  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (name.length < 1 || name.length > 120) return { ok: false, error: 'name must be 1–120 characters' };

  const entryUrlRaw = typeof input.entryUrl === 'string' ? input.entryUrl.trim() : '';
  const entryOrigin = widgetEntryOrigin(entryUrlRaw);
  if (!entryOrigin) return { ok: false, error: 'entryUrl must be an absolute https URL (http allowed only for localhost)' };
  if (entryUrlRaw.length > 2000) return { ok: false, error: 'entryUrl must be at most 2000 characters' };

  const iconUrlRaw = typeof input.iconUrl === 'string' ? input.iconUrl.trim() : '';
  if (iconUrlRaw && !widgetEntryOrigin(iconUrlRaw)) {
    return { ok: false, error: 'iconUrl must be an absolute https URL' };
  }

  const permissionsRaw = Array.isArray(input.permissions) ? input.permissions : [];
  const unknown = permissionsRaw.find((p) => !isCanvasWidgetPermission(p));
  if (unknown !== undefined) {
    return { ok: false, error: `Unsupported permission: ${String(unknown)}. Allowed: ${CANVAS_WIDGET_PERMISSIONS.join(', ')}` };
  }
  // De-duplicated and ordered by the canonical vocabulary so two registrations of
  // the same grant compare equal, and so a diff of an upgrade shows the change
  // rather than a reshuffle.
  const permissions = CANVAS_WIDGET_PERMISSIONS.filter((p) => (permissionsRaw as string[]).includes(p));

  const version = typeof input.version === 'string' && input.version.trim() ? input.version.trim() : '1.0.0';
  if (!VERSION_RE.test(version)) return { ok: false, error: 'version must look like 1, 1.0 or 1.0.0' };

  const description = typeof input.description === 'string' && input.description.trim()
    ? input.description.trim().slice(0, 2000)
    : null;

  const width = clampDimension(input.width, 480);
  const height = clampDimension(input.height, 360);

  return {
    ok: true,
    manifest: {
      key, name, description,
      entryUrl: entryUrlRaw,
      entryOrigin,
      iconUrl: iconUrlRaw || null,
      permissions: [...permissions],
      version, width, height,
    },
  };
}

/** A frame smaller than 80px cannot be clicked out of and one larger than 4000
 *  is a canvas-sized overlay; both are bounded rather than rejected so a sloppy
 *  manifest still registers. */
function clampDimension(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(4000, Math.max(80, Math.round(n)));
}

/**
 * The `resource_type` a `creation_session_objects` row carries when it is a widget
 * placement; `resource_id` is then the widget's registry id.
 *
 * A placement is NOT a new object kind and NOT a new table. The canvas already
 * models "an object on a board that points at a resource elsewhere" — that is what
 * `resourceType`/`resourceId` are — and a third-party rectangle is the least
 * special case of it there has ever been. Adding a `widget` kind would put a
 * vendor's name in a vocabulary that every export, search projection and preview
 * card has to understand.
 */
export const CANVAS_WIDGET_RESOURCE_TYPE = 'canvas_widget';
