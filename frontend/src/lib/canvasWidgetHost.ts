import {
  CANVAS_WIDGET_PROTOCOL_VERSION,
  WIDGET_CHANNEL,
  WIDGET_MAX_FRAME_HEIGHT,
  WIDGET_STORAGE_MAX_BYTES,
  type HostToWidgetMessage,
  type HostToWidgetMessageType,
  type WidgetMessageRejection,
  type WidgetToHostMessage,
  type WidgetToHostMessageType,
} from '@builderforce/canvas-widget-protocol';

/**
 * WHAT A WIDGET'S MESSAGE DOES — the browser half of the third-party widget runtime.
 *
 * `@builderforce/canvas-widget-protocol` decides whether a message may be HEARD
 * (channel, origin, version, allowlist, the registered permission). This decides what
 * a heard message DOES, against a board it reaches only through {@link WidgetHostBridge}
 * — the widget never sees a board object, a store or a callback, only the answers the
 * bridge gives. Pure and synchronous, so the whole dispatch is a table a test reads.
 *
 * ── WHY A TABLE AND NOT A SWITCH ─────────────────────────────────────────────
 * The protocol keys `WIDGET_MESSAGE_PERMISSION` by the message-type union so a new type
 * that forgets its permission does not compile. {@link HANDLERS} is keyed the same way
 * for the same reason: a new type that forgets what it DOES does not compile either.
 */

/** What a widget may read about an object — deliberately NOT its data. An object's
 *  fields include things no third party should see (a candidate's restricted fields,
 *  a contract's terms); the id, kind, title and status are what a widget needs to
 *  point at one, and `item:read` is granted blind at install time. */
export interface WidgetItem {
  id: string;
  kind: string;
  title: string;
  status?: string;
  position?: { x: number; y: number };
}

export type WidgetWriteResult = { ok: true; id?: string } | { ok: false; error: string };

export type WidgetNoticeTone = 'info' | 'success' | 'warning' | 'error';

/** The board as a widget reaches it. Built by the host from the canvas's own edit
 *  paths, so a widget's write is the same write a person's would be. */
export interface WidgetHostBridge {
  board(): { id: string; title: string };
  items(): WidgetItem[];
  createItem(input: { kind: string; title?: string; data?: Record<string, unknown> }): WidgetWriteResult;
  updateItem(id: string, patch: Record<string, unknown>): WidgetWriteResult;
  deleteItem(id: string): WidgetWriteResult;
  /** Display name and avatar only — NEVER the email (see the protocol's permission list). */
  user(): { displayName: string; avatarUrl?: string } | null;
  storage(): Record<string, unknown>;
  setStorage(value: Record<string, unknown>): WidgetWriteResult;
  notify(message: string, tone: WidgetNoticeTone): void;
}

/** The two things a widget may ask of its own frame. */
export interface WidgetFrameControls {
  resize(height: number): void;
  close(): void;
}

/** What the admin approved at registration — never what the frame says about itself. */
export interface WidgetGrant {
  id: string;
  key: string;
  version: string;
  permissions: readonly string[];
}

export function hostMessage(type: HostToWidgetMessageType, requestId?: string, payload?: unknown): HostToWidgetMessage {
  return {
    channel: WIDGET_CHANNEL,
    protocol: CANVAS_WIDGET_PROTOCOL_VERSION,
    type,
    ...(requestId ? { requestId } : {}),
    ...(payload !== undefined ? { payload } : {}),
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/** Serialised size, in bytes, of a storage blob. */
export function storageBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value ?? {})).length;
}

const TONES: readonly WidgetNoticeTone[] = ['info', 'success', 'warning', 'error'];

interface HandlerContext {
  message: WidgetToHostMessage;
  payload: Record<string, unknown>;
  bridge: WidgetHostBridge;
  frame: WidgetFrameControls;
  grant: WidgetGrant;
}

type Handler = (context: HandlerContext) => HostToWidgetMessage | null;

const result = (context: HandlerContext, payload: unknown) => hostMessage('host.result', context.message.requestId, payload);
const failure = (context: HandlerContext, error: string) => hostMessage('host.error', context.message.requestId, { error });
const written = (context: HandlerContext, outcome: WidgetWriteResult) => (outcome.ok
  ? result(context, outcome.id ? { ok: true, id: outcome.id } : { ok: true })
  : failure(context, outcome.error));

/** The handshake payload: who the widget is, and only what it was granted to read. */
export function widgetInitPayload(bridge: WidgetHostBridge, grant: WidgetGrant) {
  return {
    protocol: CANVAS_WIDGET_PROTOCOL_VERSION,
    widget: { id: grant.id, key: grant.key, version: grant.version },
    permissions: [...grant.permissions],
    board: grant.permissions.includes('board:read') ? bridge.board() : null,
    user: grant.permissions.includes('user:read') ? bridge.user() : null,
  };
}

const HANDLERS: Record<WidgetToHostMessageType, Handler> = {
  'widget.ready': (context) => hostMessage('host.init', context.message.requestId, widgetInitPayload(context.bridge, context.grant)),
  'widget.resize': (context) => {
    const height = Number(context.payload.height);
    if (!Number.isFinite(height) || height <= 0) return failure(context, 'height must be a positive number');
    const clamped = Math.min(WIDGET_MAX_FRAME_HEIGHT, Math.max(80, Math.round(height)));
    context.frame.resize(clamped);
    return result(context, { height: clamped });
  },
  // No answer: the frame is being removed, and a reply to a closing frame is noise.
  'widget.close': (context) => { context.frame.close(); return null; },
  'widget.getBoard': (context) => result(context, context.bridge.board()),
  'widget.getItems': (context) => result(context, { items: context.bridge.items() }),
  'widget.createItem': (context) => {
    const kind = text(context.payload.kind, 64);
    if (!kind) return failure(context, 'kind is required');
    const title = text(context.payload.title);
    const data = record(context.payload.data);
    return written(context, context.bridge.createItem({ kind, ...(title ? { title } : {}), ...(data ? { data } : {}) }));
  },
  'widget.updateItem': (context) => {
    const id = text(context.payload.id, 128);
    const patch = record(context.payload.patch);
    if (!id || !patch) return failure(context, 'id and patch are required');
    return written(context, context.bridge.updateItem(id, patch));
  },
  'widget.deleteItem': (context) => {
    const id = text(context.payload.id, 128);
    if (!id) return failure(context, 'id is required');
    return written(context, context.bridge.deleteItem(id));
  },
  'widget.getUser': (context) => result(context, { user: context.bridge.user() }),
  'widget.getStorage': (context) => result(context, { value: context.bridge.storage() }),
  'widget.setStorage': (context) => {
    const value = record(context.payload.value);
    if (!value) return failure(context, 'value must be an object');
    if (storageBytes(value) > WIDGET_STORAGE_MAX_BYTES) return failure(context, `storage is limited to ${WIDGET_STORAGE_MAX_BYTES} bytes`);
    return written(context, context.bridge.setStorage(value));
  },
  'widget.notify': (context) => {
    const message = text(context.payload.message, 280);
    if (!message) return failure(context, 'message is required');
    const tone = (TONES as readonly string[]).includes(String(context.payload.tone)) ? context.payload.tone as WidgetNoticeTone : 'info';
    context.bridge.notify(message, tone);
    return result(context, { ok: true });
  },
};

/**
 * Do what one ALREADY-VERIFIED message asks. Call only with a message
 * `parseWidgetMessage` accepted — this trusts the type and the permission.
 */
export function handleWidgetMessage(
  message: WidgetToHostMessage,
  bridge: WidgetHostBridge,
  frame: WidgetFrameControls,
  grant: WidgetGrant,
): HostToWidgetMessage | null {
  return HANDLERS[message.type]({ message, payload: record(message.payload) ?? {}, bridge, frame, grant });
}

/**
 * The answer to a refused message, or null for silence.
 *
 * A message that is not ours, or not from the registered frame, gets NOTHING — the
 * protocol orders the origin check first so a stranger cannot probe which types exist,
 * and an error reply would be exactly that probe. A message from our widget that asked
 * for something it was not granted, or spoke the wrong version, gets told why: that is
 * the integrator's bug report.
 */
export function rejectionReply(reason: WidgetMessageRejection, raw: unknown): HostToWidgetMessage | null {
  if (reason === 'not-our-channel' || reason === 'untrusted-origin') return null;
  const requestId = record(raw) && typeof (raw as Record<string, unknown>).requestId === 'string'
    ? String((raw as Record<string, unknown>).requestId).slice(0, 128)
    : undefined;
  return hostMessage('host.error', requestId, { error: reason });
}

/** What a widget hears when the board under it changes — only what it may read. */
export function boardChangedPayload(bridge: WidgetHostBridge, grant: WidgetGrant) {
  return {
    ...(grant.permissions.includes('board:read') ? { board: bridge.board() } : {}),
    ...(grant.permissions.includes('item:read') ? { items: bridge.items() } : {}),
  };
}
