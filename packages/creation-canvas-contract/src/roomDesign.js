/**
 * `room` — the shape a `room` canvas object carries: the DESIGN of the session's
 * room (its floor, its walls, and the furniture standing in it), plus the pure
 * operations that edit it and the readings the room derives from it.
 *
 * ── WHY THIS IS IN THE CONTRACT ────────────────────────────────────────────
 * Same reason `world.ts` is: the canvas draws this shape as a real WebGL room
 * (`world3d/RoomScene` under `components/creation-canvas`), Brain edits the SAME
 * field through `MUTABLE_FIELDS['room']`, the marketplace snapshots it as a
 * listing, and the API's Stage harness reads it back to say whether it is
 * sellable. Four readers of one document, so the document is declared once,
 * transport-neutral (no React, no Three.js), where all four can import it.
 *
 * ── WHAT A ROOM DESIGN IS, AND IS NOT ──────────────────────────────────────
 * It is the ROOM: where the walls are, what stands on the floor, where people
 * sit. It is NOT what the session puts in it — the session's diorama, the 3D
 * creations, the stations — because those are read live off the board by the
 * room surface, exactly as `world.ts` explains for `objectId`. A design that
 * stored "the game stands here" would be a second, staler answer to which
 * objects exist. So a design is furniture, and only furniture.
 *
 * ── WHY SEATS ARE DERIVED, NOT STORED ──────────────────────────────────────
 * A chair is where somebody sits. Storing a seat list beside the chairs would
 * be the same fact twice, and the first drag that moved a chair without its
 * seat would put a person in mid-air. `roomDesignSeats` reads the seats OFF the
 * furniture that carries them; a design with no seated furniture (the standup
 * room, a ring round one table) says so with an empty list, and the room falls
 * back to the ring it has always drawn.
 *
 * ── WHY A PRESET IS A FUNCTION AND THE LAYOUT ID IS KEPT ──────────────────
 * `ROOM_LAYOUT_PRESETS` are the rooms a person starts from — a standup circle,
 * a boardroom, an office kitchen, cubicles on an open floor. Each is BUILT, so
 * two calls never share a furniture array, and the id it was built from stays
 * on the design so a card can say "Boardroom" after the tenth piece was moved.
 * A design with `layout: 'custom'` was never a preset, or stopped being one.
 *
 * Every mutation is TOTAL, the rule `world.ts` and `website.ts` state: an
 * unknown furniture id returns the design unchanged rather than throwing.
 *
 * Units are metres and radians, matching `CanvasWorldTransform` and
 * `CanvasPresenceSpatial`, so nothing converts anything. Three.js yaw 0 faces
 * −Z: a chair with `yaw: 0` seats a person looking toward −Z.
 */
export const CANVAS_ROOM_DESIGN_SCHEMA_VERSION = 1;
/**
 * The furniture a room can hold. Each kind picks a mesh and a collider in
 * `world3d/RoomFurnitureMesh.tsx`; what it MEANS to the room is declared here in
 * `ROOM_FURNITURE_SPECS` — whether people sit on it, whether things rest on it,
 * whether a walker bumps into it.
 */
export const ROOM_FURNITURE_KINDS = [
    'tableRound', 'tableLong', 'desk', 'counter',
    'chair', 'stool', 'sofa',
    'partition', 'whiteboard', 'screen', 'poster', 'shelf', 'fridge',
    'plant', 'lamp', 'rug',
    // A piece the designer UPLOADED: its own mesh file, fitted to its footprint.
    'model',
];
export const ROOM_LAYOUT_IDS = ['standup', 'boardroom', 'kitchen', 'openPlan'];
/** What a design's `layout` reads once it is no longer any preset. */
export const ROOM_LAYOUT_CUSTOM = 'custom';
export const ROOM_FURNITURE_SPECS = {
    tableRound: { footprint: [2.7, 0.74, 2.7], seats: [], rests: true, round: true, solid: true },
    tableLong: { footprint: [5.2, 0.74, 1.5], seats: [], rests: true, solid: true },
    desk: { footprint: [1.6, 0.74, 0.8], seats: [], rests: true, solid: true },
    counter: { footprint: [2.6, 0.9, 0.7], seats: [], rests: true, solid: true },
    // A seat's spot is just BEHIND the piece (+Z, the sitter's back): the room's
    // bodies are standing figures, and one drawn inside a chair reads as a collision.
    chair: { footprint: [0.55, 0.9, 0.55], seats: [[0, 0.45]], rests: false, solid: false },
    stool: { footprint: [0.4, 0.7, 0.4], seats: [[0, 0.35]], rests: false, solid: false },
    sofa: { footprint: [1.9, 0.8, 0.9], seats: [[-0.5, 0.75], [0.5, 0.75]], rests: false, solid: true },
    partition: { footprint: [1.7, 1.4, 0.06], seats: [], rests: false, solid: true },
    whiteboard: { footprint: [1.8, 1.2, 0.06], seats: [], rests: false, solid: true, wallMounted: true, color: '#f4f6f8', takesImage: true },
    screen: { footprint: [2.4, 1.4, 0.08], seats: [], rests: false, solid: true, wallMounted: true, color: '#0f172a', takesImage: true },
    poster: { footprint: [1.0, 1.4, 0.04], seats: [], rests: false, solid: false, wallMounted: true, takesImage: true },
    shelf: { footprint: [1.2, 1.8, 0.35], seats: [], rests: false, solid: true },
    fridge: { footprint: [0.8, 1.8, 0.75], seats: [], rests: false, solid: true, color: '#d9dee5' },
    plant: { footprint: [0.5, 1.3, 0.5], seats: [], rests: false, round: true, solid: true, color: '#3f8f4f' },
    lamp: { footprint: [0.35, 1.6, 0.35], seats: [], rests: false, round: true, solid: false, color: '#f5e6b8' },
    rug: { footprint: [3, 0.02, 2], seats: [], rests: false, solid: false, color: '#7c6f9c' },
    model: { footprint: [1, 1, 1], seats: [], rests: false, solid: true, takesModel: true },
};
/** The mesh formats an uploaded piece may be. The same readers the canvas's model
 *  preview already has (`creativeGeometry.ts`), so nothing new has to parse a file. */
export const ROOM_MODEL_FORMATS = ['stl', 'obj', 'gltf', 'glb', 'step'];
/**
 * THE STANDUP ROOM — the room that existed before anybody could design one.
 *
 * These numbers are the ones `lib/canvas/roomSeating.ts` has always drawn: a
 * round table of this radius at this height, a floor this wide, a back wall this
 * far behind the ring. Declared HERE so the frontend's constants and the default
 * preset are one set of numbers rather than two that a test keeps honest.
 */
export const STANDUP_ROOM = {
    floorWidth: 14,
    floorDepth: 10.4,
    wallHeight: 4.2,
    tableRadius: 1.35,
    tableHeight: 0.74,
};
// ─── Presets ─────────────────────────────────────────────────────────────────
function piece(id, kind, x, z, yaw = 0, extra = {}) {
    return { id, kind, position: extra.position ?? [x, 0, z], yaw, scale: extra.scale ?? [1, 1, 1], ...(extra.color ? { color: extra.color } : {}) };
}
function standupRoom() {
    const diameter = STANDUP_ROOM.tableRadius * 2;
    const [w, h, d] = ROOM_FURNITURE_SPECS.tableRound.footprint;
    return {
        schemaVersion: CANVAS_ROOM_DESIGN_SCHEMA_VERSION,
        layout: 'standup',
        floor: { width: STANDUP_ROOM.floorWidth, depth: STANDUP_ROOM.floorDepth },
        wall: { height: STANDUP_ROOM.wallHeight },
        furniture: [
            piece('tableRound-1', 'tableRound', 0, 0, 0, { scale: [diameter / w, STANDUP_ROOM.tableHeight / h, diameter / d] }),
        ],
    };
}
function boardroom() {
    const width = 14;
    const depth = 10.4;
    const chairs = [];
    for (let i = 0; i < 5; i += 1) {
        const x = (i - 2) * 1.1;
        // The near side faces −Z (toward the table); the far side turns round.
        chairs.push(piece(`chair-${i + 1}`, 'chair', x, 1.25, 0));
        chairs.push(piece(`chair-${i + 6}`, 'chair', x, -1.25, Math.PI));
    }
    return {
        schemaVersion: CANVAS_ROOM_DESIGN_SCHEMA_VERSION,
        layout: 'boardroom',
        floor: { width, depth },
        wall: { height: 4.2 },
        furniture: [
            piece('tableLong-1', 'tableLong', 0, 0),
            ...chairs,
            piece('screen-1', 'screen', 0, -depth / 2 + 0.1, 0, { position: [0, 1.5, -depth / 2 + 0.1] }),
            piece('whiteboard-1', 'whiteboard', -width / 2 + 0.1, 0, Math.PI / 2, { position: [-width / 2 + 0.1, 1.4, 0] }),
            piece('plant-1', 'plant', width / 2 - 0.7, -depth / 2 + 0.7),
            piece('plant-2', 'plant', -width / 2 + 0.7, -depth / 2 + 0.7),
        ],
    };
}
function kitchen() {
    const width = 12;
    const depth = 10;
    const back = -depth / 2;
    return {
        schemaVersion: CANVAS_ROOM_DESIGN_SCHEMA_VERSION,
        layout: 'kitchen',
        floor: { width, depth },
        wall: { height: 3.6 },
        furniture: [
            piece('counter-1', 'counter', -1.6, back + 0.4, 0, { scale: [1.6, 1, 1] }),
            piece('fridge-1', 'fridge', 1.4, back + 0.42),
            piece('shelf-1', 'shelf', -1.6, back + 0.2, 0, { position: [-1.6, 1.3, back + 0.2], scale: [2.2, 0.5, 0.6] }),
            // The island, with a stool on each long side and one at each end.
            piece('counter-2', 'counter', 0, 0.6, 0, { scale: [1, 1, 1.4] }),
            piece('stool-1', 'stool', -0.7, 1.45, 0),
            piece('stool-2', 'stool', 0.7, 1.45, 0),
            piece('stool-3', 'stool', -0.7, -0.25, Math.PI),
            piece('stool-4', 'stool', 0.7, -0.25, Math.PI),
            piece('stool-5', 'stool', 1.85, 0.6, -Math.PI / 2),
            piece('stool-6', 'stool', -1.85, 0.6, Math.PI / 2),
            // The corner people actually talk in.
            piece('sofa-1', 'sofa', width / 2 - 1.2, 2.4, -Math.PI / 2),
            piece('rug-1', 'rug', width / 2 - 2.6, 2.4, Math.PI / 2),
            piece('plant-1', 'plant', -width / 2 + 0.7, depth / 2 - 0.9),
            piece('lamp-1', 'lamp', width / 2 - 0.6, depth / 2 - 0.7),
        ],
    };
}
function openPlan() {
    const width = 20;
    const depth = 16;
    const furniture = [];
    let n = 0;
    // Three rows of three pods: a desk, a chair behind it, a partition in front.
    for (let row = 0; row < 3; row += 1) {
        for (let col = 0; col < 3; col += 1) {
            n += 1;
            const x = (col - 1) * 5.2;
            const z = (row - 1) * 4.2 + 0.6;
            furniture.push(piece(`desk-${n}`, 'desk', x, z));
            furniture.push(piece(`chair-${n}`, 'chair', x, z + 0.75, 0));
            furniture.push(piece(`partition-${n}`, 'partition', x, z - 0.55));
            furniture.push(piece(`partition-${n + 9}`, 'partition', x - 0.95, z + 0.1, Math.PI / 2, { scale: [0.8, 1, 1] }));
        }
    }
    furniture.push(piece('whiteboard-1', 'whiteboard', 0, -depth / 2 + 0.1, 0, { position: [0, 1.4, -depth / 2 + 0.1], scale: [1.6, 1, 1] }));
    furniture.push(piece('plant-1', 'plant', width / 2 - 0.8, -depth / 2 + 0.8));
    furniture.push(piece('plant-2', 'plant', -width / 2 + 0.8, -depth / 2 + 0.8));
    furniture.push(piece('plant-3', 'plant', width / 2 - 0.8, depth / 2 - 0.8));
    return {
        schemaVersion: CANVAS_ROOM_DESIGN_SCHEMA_VERSION,
        layout: 'openPlan',
        floor: { width, depth },
        wall: { height: 3.8 },
        furniture,
    };
}
/** The rooms a person starts from. Order is the order the designer offers them. */
export const ROOM_LAYOUT_PRESETS = [
    { id: 'standup', build: standupRoom },
    { id: 'boardroom', build: boardroom },
    { id: 'kitchen', build: kitchen },
    { id: 'openPlan', build: openPlan },
];
export function isRoomLayoutId(value) {
    return typeof value === 'string' && ROOM_LAYOUT_IDS.includes(value);
}
/** The preset's design, or the standup room for an id nobody declared. */
export function roomLayoutDesign(id) {
    const preset = ROOM_LAYOUT_PRESETS.find((candidate) => candidate.id === id) ?? ROOM_LAYOUT_PRESETS[0];
    return preset.build();
}
/** The room the session has when nobody has designed one. */
export function defaultCanvasRoomDesign() {
    return standupRoom();
}
// ─── Mutations ───────────────────────────────────────────────────────────────
function nextFurnitureId(design, kind) {
    let max = 0;
    const re = new RegExp(`^${kind}-(\\d+)$`);
    for (const item of design.furniture) {
        const m = re.exec(item.id);
        if (m)
            max = Math.max(max, Number.parseInt(m[1] ?? '0', 10));
    }
    return `${kind}-${max + 1}`;
}
/** Any edit to the furniture makes the design its own — the preset it began from
 *  is remembered as history, not claimed as identity. */
function customised(design, furniture) {
    return { ...design, layout: ROOM_LAYOUT_CUSTOM, furniture };
}
/**
 * Stand a new piece in the room. Wall-mounted kinds are lifted to a reading
 * height so a screen dropped on the floor is not a screen lying on the floor.
 * Returns the new design and the new piece, so a designer can select it.
 */
export function addRoomFurniture(design, opts) {
    const spec = ROOM_FURNITURE_SPECS[opts.kind];
    const position = opts.position ?? [0, 0, 0];
    const imageUrl = spec.takesImage ? safeUrl(opts.imageUrl) : undefined;
    const model = spec.takesModel ? furnitureModel(opts.model) : undefined;
    const furniture = {
        id: nextFurnitureId(design, opts.kind),
        kind: opts.kind,
        position: spec.wallMounted && position[1] === 0 ? [position[0], 1.4, position[2]] : position,
        yaw: opts.yaw ?? 0,
        scale: opts.scale ?? [1, 1, 1],
        // Spread, not assigned, so a plain piece carries no `color: undefined` key into
        // the jsonb column — see `addProp` in `world.ts` for why that matters.
        ...(opts.color ? { color: opts.color } : {}),
        ...(imageUrl ? { imageUrl } : {}),
        ...(model ? { model } : {}),
    };
    return { design: customised(design, [...design.furniture, furniture]), furniture };
}
export function updateRoomFurniture(design, id, patch) {
    if (!design.furniture.some((item) => item.id === id))
        return design;
    return customised(design, design.furniture.map((item) => {
        if (item.id !== id)
            return item;
        const spec = ROOM_FURNITURE_SPECS[item.kind];
        const next = { ...item, ...patch };
        // An emptied optional field means "back to the default", and the key must go,
        // not stay holding undefined (see `setPropSurface` in `world.ts`). A picture or a
        // mesh on a kind that cannot carry one is dropped the same way.
        if (!next.color)
            delete next.color;
        const imageUrl = spec.takesImage ? safeUrl(next.imageUrl) : undefined;
        if (imageUrl)
            next.imageUrl = imageUrl;
        else
            delete next.imageUrl;
        const model = spec.takesModel ? furnitureModel(next.model) : undefined;
        if (model)
            next.model = model;
        else
            delete next.model;
        return next;
    }));
}
/** How far a wall-mounted piece stands off the wall it hangs on. */
const WALL_OFFSET = 0.08;
/**
 * Put a piece down where a drag left it — the ONE placement rule the designer, Brain
 * and a test all use.
 *
 * A floor piece stays inside the walls (its centre clamped so its footprint does
 * not cross one). A wall-mounted piece is never on the floor: it goes onto the
 * NEAREST wall to the point, at the height it already hangs, turned to face into
 * the room — so dragging a screen across the floor slides it from wall to wall.
 */
export function moveRoomFurniture(design, id, x, z) {
    const item = design.furniture.find((candidate) => candidate.id === id);
    if (!item || !Number.isFinite(x) || !Number.isFinite(z))
        return design;
    const spec = ROOM_FURNITURE_SPECS[item.kind];
    const hw = design.floor.width / 2;
    const hd = design.floor.depth / 2;
    const halfW = (spec.footprint[0] * item.scale[0]) / 2;
    if (spec.wallMounted) {
        const walls = [
            { gap: Math.abs(z + hd), position: [x, -hd + WALL_OFFSET], yaw: 0, along: hw },
            { gap: Math.abs(z - hd), position: [x, hd - WALL_OFFSET], yaw: Math.PI, along: hw },
            { gap: Math.abs(x + hw), position: [-hw + WALL_OFFSET, z], yaw: Math.PI / 2, along: hd },
            { gap: Math.abs(x - hw), position: [hw - WALL_OFFSET, z], yaw: -Math.PI / 2, along: hd },
        ];
        const wall = walls.reduce((best, next) => (next.gap < best.gap ? next : best));
        const limit = Math.max(0, wall.along - halfW);
        const [px, pz] = wall.position;
        const alongX = wall.yaw === 0 || wall.yaw === Math.PI;
        return updateRoomFurniture(design, id, {
            position: [
                alongX ? Math.min(limit, Math.max(-limit, px)) : px,
                item.position[1] > 0 ? item.position[1] : 1.4,
                alongX ? pz : Math.min(limit, Math.max(-limit, pz)),
            ],
            yaw: wall.yaw,
        });
    }
    // A turned piece's footprint is its larger half-extent in any direction.
    const reach = Math.max(halfW, (spec.footprint[2] * item.scale[2]) / 2);
    const limitX = Math.max(0, hw - reach);
    const limitZ = Math.max(0, hd - reach);
    return updateRoomFurniture(design, id, {
        position: [Math.min(limitX, Math.max(-limitX, x)), item.position[1], Math.min(limitZ, Math.max(-limitZ, z))],
    });
}
export function removeRoomFurniture(design, id) {
    if (!design.furniture.some((item) => item.id === id))
        return design;
    return customised(design, design.furniture.filter((item) => item.id !== id));
}
export function updateRoomFloor(design, patch) {
    const floor = { ...design.floor, ...patch };
    if ('color' in patch && !patch.color)
        delete floor.color;
    return { ...design, floor };
}
export function updateRoomWall(design, patch) {
    const wall = { ...design.wall, ...patch };
    if ('color' in patch && !patch.color)
        delete wall.color;
    return { ...design, wall };
}
export function setRoomSky(design, sky) {
    if (!sky) {
        const { sky: _dropped, ...bare } = design;
        return bare;
    }
    return { ...design, sky };
}
/**
 * Every seat in the room, in furniture order — so the first person on the roster
 * takes the first chair the designer placed. Empty when nothing seats anyone,
 * which the room reads as "stand in a ring".
 */
export function roomDesignSeats(design) {
    const seats = [];
    for (const item of design.furniture) {
        const spec = ROOM_FURNITURE_SPECS[item.kind];
        const sin = Math.sin(item.yaw);
        const cos = Math.cos(item.yaw);
        for (const [lx, lz] of spec.seats) {
            const x = lx * item.scale[0];
            const z = lz * item.scale[2];
            // Rotate the local offset by the piece's yaw (about +Y), then translate.
            seats.push({
                position: [item.position[0] + x * cos + z * sin, 0, item.position[2] - x * sin + z * cos],
                yaw: item.yaw,
            });
        }
    }
    return seats;
}
export function roomDesignGeometry(design) {
    const rests = design.furniture.flatMap((item) => {
        const spec = ROOM_FURNITURE_SPECS[item.kind];
        if (!spec.rests)
            return [];
        return [{
                x: item.position[0],
                z: item.position[2],
                halfX: (spec.footprint[0] * item.scale[0]) / 2,
                halfZ: (spec.footprint[2] * item.scale[2]) / 2,
                yaw: item.yaw,
                height: item.position[1] + spec.footprint[1] * item.scale[1],
                round: !!spec.round,
            }];
    });
    return {
        halfWidth: design.floor.width / 2,
        halfDepth: design.floor.depth / 2,
        wallZ: -design.floor.depth / 2,
        wallHeight: design.wall.height,
        rests,
    };
}
/** The rest surface under a point on the floor plane, or null on bare floor. */
export function restSurfaceAt(geometry, x, z) {
    for (const rest of geometry.rests) {
        const dx = x - rest.x;
        const dz = z - rest.z;
        if (rest.round) {
            if (Math.hypot(dx, dz) <= Math.max(rest.halfX, rest.halfZ))
                return rest;
            continue;
        }
        // Into the surface's own frame, then a box test.
        const cos = Math.cos(rest.yaw);
        const sin = Math.sin(rest.yaw);
        const lx = dx * cos - dz * sin;
        const lz = dx * sin + dz * cos;
        if (Math.abs(lx) <= rest.halfX && Math.abs(lz) <= rest.halfZ)
            return rest;
    }
    return null;
}
/**
 * Where a walker enters the room: the front, in the middle, facing the room —
 * clear of the ring of chairs and of anything a preset stands there.
 *
 * Read from the FLOOR alone, deliberately: a walker is teleported whenever its spawn
 * changes, and a collaborator moving a chair must not send everybody back to the door.
 */
export function roomDesignSpawn(floor) {
    return { position: [0, 0, Math.max(1.5, floor.depth / 2 - 1.4)], yaw: 0 };
}
export function roomDesignSummary(design) {
    return {
        pieces: design.furniture.length,
        seats: roomDesignSeats(design).length,
        area: design.floor.width * design.floor.depth,
    };
}
// ─── Defensive read ──────────────────────────────────────────────────────────
export const MIN_FLOOR = 6;
export const MAX_FLOOR = 60;
const MIN_WALL = 2.4;
const MAX_WALL = 10;
const MIN_SCALE = 0.2;
const MAX_SCALE = 8;
/** More than this is not a room, it is a payload. */
export const MAX_FURNITURE = 400;
function finite(value, fallback, min = -Infinity, max = Infinity) {
    const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    return Math.min(max, Math.max(min, n));
}
function color(value) {
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : undefined;
}
/**
 * Largest URL a piece may reference — the same ceiling `world.ts` puts on a prop's
 * picture, for the same reason: a `data:` blob would make one chair the size of the
 * whole design. Uploads live behind a URL (`uploadCanvasFile`).
 */
const MAX_URL = 2_048;
/** An https or same-origin URL, or nothing. A `javascript:` or `data:` URL is not a
 *  picture on a wall; it is a payload a stranger's room would hand to a buyer. */
function safeUrl(value) {
    if (typeof value !== 'string')
        return undefined;
    const url = value.trim();
    if (!url || url.length > MAX_URL)
        return undefined;
    return /^https:\/\//i.test(url) || (url.startsWith('/') && !url.startsWith('//')) ? url : undefined;
}
function furnitureModel(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return undefined;
    const raw = value;
    const url = safeUrl(raw.url);
    const format = typeof raw.format === 'string' && ROOM_MODEL_FORMATS.includes(raw.format)
        ? raw.format
        : undefined;
    return url && format ? { url, format } : undefined;
}
function isFurnitureKind(value) {
    return typeof value === 'string' && ROOM_FURNITURE_KINDS.includes(value);
}
/**
 * Read a design back from whatever a canvas object's `roomDesign` field actually
 * holds — untrusted at the type level (jsonb round-trip, a Brain-authored patch,
 * a marketplace snapshot from a stranger). Malformed pieces are dropped rather
 * than crashing the room; every other field clamps to something a person could
 * stand in. Not-a-design at all reads as the standup room.
 */
export function canvasRoomDesignFrom(value) {
    const fallback = defaultCanvasRoomDesign();
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return fallback;
    const raw = value;
    const floor = raw.floor && typeof raw.floor === 'object' ? raw.floor : {};
    const wall = raw.wall && typeof raw.wall === 'object' ? raw.wall : {};
    const width = finite(floor.width, fallback.floor.width, MIN_FLOOR, MAX_FLOOR);
    const depth = finite(floor.depth, fallback.floor.depth, MIN_FLOOR, MAX_FLOOR);
    const furniture = Array.isArray(raw.furniture) ? raw.furniture.slice(0, MAX_FURNITURE).flatMap((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry))
            return [];
        const item = entry;
        if (!isFurnitureKind(item.kind))
            return [];
        const kind = item.kind;
        const spec = ROOM_FURNITURE_SPECS[kind];
        const p = Array.isArray(item.position) ? item.position : [];
        const s = Array.isArray(item.scale) ? item.scale : [];
        const tint = color(item.color);
        const imageUrl = spec.takesImage ? safeUrl(item.imageUrl) : undefined;
        const model = spec.takesModel ? furnitureModel(item.model) : undefined;
        // An uploaded piece whose file is gone is an invisible collider — drop it.
        if (spec.takesModel && !model)
            return [];
        return [{
                id: typeof item.id === 'string' && item.id ? item.id : `${kind}-${index}`,
                kind,
                position: [
                    finite(p[0], 0, -width / 2, width / 2),
                    finite(p[1], 0, 0, MAX_WALL),
                    finite(p[2], 0, -depth / 2, depth / 2),
                ],
                yaw: finite(item.yaw, 0, -Math.PI * 4, Math.PI * 4),
                scale: [finite(s[0], 1, MIN_SCALE, MAX_SCALE), finite(s[1], 1, MIN_SCALE, MAX_SCALE), finite(s[2], 1, MIN_SCALE, MAX_SCALE)],
                ...(tint ? { color: tint } : {}),
                ...(imageUrl ? { imageUrl } : {}),
                ...(model ? { model } : {}),
            }];
    }) : [];
    const floorColor = color(floor.color);
    const wallColor = color(wall.color);
    const sky = color(raw.sky);
    const layout = typeof raw.layout === 'string' && raw.layout ? raw.layout : ROOM_LAYOUT_CUSTOM;
    return {
        schemaVersion: CANVAS_ROOM_DESIGN_SCHEMA_VERSION,
        layout: isRoomLayoutId(layout) || layout === ROOM_LAYOUT_CUSTOM ? layout : ROOM_LAYOUT_CUSTOM,
        floor: { width, depth, ...(floorColor ? { color: floorColor } : {}) },
        wall: { height: finite(wall.height, fallback.wall.height, MIN_WALL, MAX_WALL), ...(wallColor ? { color: wallColor } : {}) },
        ...(sky ? { sky } : {}),
        furniture,
    };
}
/**
 * The design a `room` OBJECT carries, from its two authorable fields.
 *
 * `roomDesign` is the whole document when a person or Brain has edited one;
 * `roomLayout` alone names a preset — which is all Brain needs to say to turn the
 * room into a kitchen, and all a card needs to hold to be a room at all. A room
 * with neither is the standup room, deliberately: that is what every session had
 * before rooms could be designed, and a title-only room card is not an empty shell.
 */
export function roomDesignOf(data) {
    if (data.roomDesign && typeof data.roomDesign === 'object')
        return canvasRoomDesignFrom(data.roomDesign);
    return roomLayoutDesign(data.roomLayout);
}
//# sourceMappingURL=roomDesign.js.map