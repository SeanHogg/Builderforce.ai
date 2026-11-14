/**
 * Live presence — the ONE frame a canvas peer may put on the wire.
 *
 * The canvas WebSocket was deliberately domain-free: a `{type:"changed"}` ping
 * and nothing else, "so there is nothing here that could leak across segments".
 * Carrying a pointer at pointer speed means a client→client relay, and the way
 * that keeps the original property is not trust — it is SHAPE. `canvasPresenceFrame`
 * is a total function from anything a socket sends to at most this fixed record of
 * ephemeral view state, and the relay forwards its output rather than the input.
 * A field that is not declared here cannot cross the relay, whatever a client puts
 * in the frame.
 *
 * Declared in the contract package because both ends must agree exactly: the
 * Durable Object sanitizes with this function, and the canvas merges the result
 * onto the member roster it already holds. Two copies would drift the moment one
 * side added a field, and the drift would look like "cursors stopped working".
 *
 * Everything here is EPHEMERAL. Nothing is persisted by the relay — the durable
 * record of who is in a session stays with `POST /:id/presence`, which is also the
 * fallback when the socket cannot be established.
 */
/** The canvas relay's single client frame type. */
export const CANVAS_PRESENCE_FRAME = 'canvas.presence';
/**
 * The id an account-less guest-room participant is known by on the canvas — the key of
 * their roster row AND of their relayed presence. Built from what the room's public
 * roster already shows (display name and join instant), never from the visitor id,
 * which must not reach another visitor's browser. Declared here so the guest-room
 * relay's stamp and the canvas roster cannot spell it differently: if they did, every
 * guest's cursor would arrive keyed to nobody.
 */
export function guestRoomOccupantId(participant) {
    return `guest:${participant.name}:${participant.joinedAt}`;
}
/** Largest coordinate accepted. A board is finite; NaN/Infinity are not points. */
const COORD_LIMIT = 1_000_000;
function finite(value, limit = COORD_LIMIT) {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}
function point(value) {
    if (!value || typeof value !== 'object')
        return null;
    const x = finite(value.x);
    const y = finite(value.y);
    return x === null || y === null ? null : { x, y };
}
/**
 * Narrow a body position. A room is metres across, not kilometres, so an
 * out-of-range coordinate is a bug or an attack rather than a far-away peer —
 * either way it is dropped, and the caller treats that as "left the surface".
 */
const WORLD_LIMIT = 10_000;
function spatial(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const raw = value;
    if (!Array.isArray(raw.position) || raw.position.length !== 3)
        return null;
    const x = finite(raw.position[0], WORLD_LIMIT);
    const y = finite(raw.position[1], WORLD_LIMIT);
    const z = finite(raw.position[2], WORLD_LIMIT);
    const yaw = finite(raw.yaw, Math.PI * 4);
    if (x === null || y === null || z === null || yaw === null)
        return null;
    // A seat is a ring index, so it is a small non-negative integer or nothing.
    const seat = finite(raw.seat, 1_000);
    const seated = seat !== null && Number.isInteger(seat) && seat >= 0;
    // A space is an object id: short, and only the characters an id is made of, so
    // the relay cannot be used to carry arbitrary text between peers.
    const space = typeof raw.space === 'string' && /^[A-Za-z0-9_:.-]{1,80}$/.test(raw.space) ? raw.space : null;
    return { position: [x, y, z], yaw, ...(seated ? { seat } : {}), ...(space ? { space } : {}) };
}
/** Latest instant a run may claim to have started — centuries out, short of a garbage value. */
const EPOCH_LIMIT_MS = 1e13;
function brainRun(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const startedAt = finite(value.startedAt, EPOCH_LIMIT_MS);
    return startedAt !== null && startedAt > 0 ? { startedAt } : null;
}
/** A space is an object id: short, and only the characters an id is made of. */
const PLAY_ID = /^[A-Za-z0-9_:.-]{1,80}$/;
/** A level is not a thousand coins; anything past this is noise or an attack. */
const PLAY_COLLECTED_LIMIT = 64;
function play(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const raw = value;
    if (!Array.isArray(raw.collected))
        return null;
    const collected = [];
    const seen = new Set();
    for (const id of raw.collected) {
        if (typeof id !== 'string' || !PLAY_ID.test(id) || seen.has(id))
            continue;
        seen.add(id);
        collected.push(id);
        if (collected.length >= PLAY_COLLECTED_LIMIT)
            break;
    }
    return { collected, ...(raw.won === true ? { won: true } : {}) };
}
/**
 * Narrow anything a client sent to the presence state this relay carries, or null
 * when there is nothing worth relaying.
 *
 * `cursor: null` is MEANINGFUL and is preserved — it is how a peer says its pointer
 * left the board, and dropping it would leave a ghost cursor parked wherever the
 * last move happened to be.
 */
export function canvasPresenceFrame(input) {
    if (!input || typeof input !== 'object')
        return null;
    const raw = input;
    const state = {};
    if ('cursor' in raw) {
        const cursor = point(raw.cursor);
        // An unparseable cursor is treated as "no pointer" rather than dropped, so a
        // malformed frame still retracts a stale one instead of freezing it.
        state.cursor = cursor;
    }
    if (raw.viewport && typeof raw.viewport === 'object') {
        const at = point(raw.viewport);
        const zoom = finite(raw.viewport.zoom, 1_000);
        if (at && zoom !== null && zoom > 0)
            state.viewport = { ...at, zoom };
    }
    if (typeof raw.typing === 'boolean')
        state.typing = raw.typing;
    // Same rule the cursor follows: an unparseable body is "left the surface"
    // rather than a dropped field, so a malformed frame retracts a stale avatar
    // instead of leaving it standing in the room forever.
    if ('spatial' in raw)
        state.spatial = spatial(raw.spatial);
    // Same rule again: a settled run is announced as `null`, and an unparseable one
    // reads as settled, so nobody is left watching a Brain that stopped long ago.
    if ('brainRun' in raw)
        state.brainRun = brainRun(raw.brainRun);
    // Leaving play is `null`, same as leaving a surface. An unparseable score
    // retracts a stale tally instead of freezing it on everyone else's HUD.
    if ('play' in raw)
        state.play = play(raw.play);
    return Object.keys(state).length ? state : null;
}
//# sourceMappingURL=presence.js.map