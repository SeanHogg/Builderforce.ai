/**
 * THE FRONTEND CONTEXT MAP.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────
 * PRD 22 §4.2 talks about a "Canvas domain", a "Training domain", an "Inference
 * domain" and a "Voice domain". None of them were defined anywhere, none of them
 * declared a relationship to PRD 20's backend bounded contexts, and §3.4's
 * proposed `graph.ts` / `history.ts` / `selection.ts` were modules split by
 * TOPIC — three files, one implicit aggregate, and every Canvas invariant still
 * living inside a React callback where nothing can assert it.
 *
 * A "domain" that is only a word in a document buys nothing. This is the list,
 * with the two things a context map must actually carry: who owns which
 * language, and what the relationship is where two of them meet.
 *
 * ── WHY IT IS DATA AND NOT PROSE ─────────────────────────────────────────────
 * `check-canvas-glossary.mjs` reads it. A term that appears in the Canvas
 * vocabulary must be spelled the way this file spells it, and a context must
 * declare a relationship to every context it names — the same shape as
 * `check-prompt-tool-names.mjs`, which exists because a document nobody can
 * execute drifts from the code silently and is discovered by a user.
 */

/**
 * How two contexts meet. Named after the standard strategic patterns because the
 * choice between them is a real decision with real consequences, not a label:
 *
 *  - `sharedKernel` — both sides own the same model and change it together. Only
 *    honest when one team owns both; here that is the canvas contract package,
 *    which frontend and API both compile against.
 *  - `conformist` — this side accepts the other's model as-is. Cheap, and
 *    correct when the upstream model is genuinely the right one.
 *  - `antiCorruption` — this side translates at the boundary because adopting
 *    the upstream model would corrupt its own. Costs a translation layer and
 *    buys a language that stays coherent.
 *  - `customerSupplier` — downstream's needs are negotiated INTO upstream's
 *    plan; upstream is not free to break it.
 */
export type ContextRelationshipKind =
  | 'sharedKernel'
  | 'conformist'
  | 'antiCorruption'
  | 'customerSupplier';

export interface ContextRelationship {
  /** The other context, by `id` — frontend or a PRD 20 backend context. */
  with: string;
  kind: ContextRelationshipKind;
  /** Why this pattern and not another. A relationship with no reason is a guess. */
  why: string;
}

export interface FrontendContext {
  id: string;
  /** The ubiquitous language this context owns. Enforced by the glossary check. */
  terms: readonly string[];
  /** Where the code lives. One context, one home — a context spread over the
   *  tree is a topic, not a boundary. */
  roots: readonly string[];
  /** The aggregate root, when this context has one. */
  aggregate?: string;
  relationships: readonly ContextRelationship[];
}

/**
 * PRD 20's backend contexts this frontend actually talks to. Listed so a
 * relationship can NAME one — a context map with only one side of every
 * relationship is a directory.
 */
export const BACKEND_CONTEXTS = [
  'creation', 'delivery', 'identity', 'governance', 'commerce',
  'people', 'agents', 'platform', 'revenue', 'support',
] as const;

export const FRONTEND_CONTEXTS: readonly FrontendContext[] = [
  {
    id: 'canvas',
    aggregate: 'CanvasBoard',
    terms: ['CanvasBoard', 'CanvasObject', 'CanvasCommand', 'CanvasEvent', 'Selection', 'Checkpoint', 'Branch'],
    roots: ['components/creation-canvas', 'lib/canvas'],
    relationships: [
      {
        with: 'creation',
        kind: 'sharedKernel',
        why: 'The board, its objects and their kinds are declared once in @builderforce/creation-canvas-contract and compiled by BOTH sides. A second description of a résumé revision is how the editor and the public link came to disagree about which revision was live.',
      },
      {
        with: 'live',
        kind: 'customerSupplier',
        why: 'Collaboration transports what the board decides. The board is free to add an event; the transport is not free to invent one.',
      },
    ],
  },
  {
    id: 'live',
    terms: ['Room', 'Participant', 'Presence', 'Anchor'],
    roots: ['lib/live', 'lib/useMediaRoom.ts', 'lib/useGuestRoom.ts'],
    relationships: [
      {
        with: 'canvas',
        kind: 'conformist',
        why: 'A room is anchored to whatever surface publishes an anchor; it does not model boards itself.',
      },
      {
        with: 'identity',
        kind: 'antiCorruption',
        why: 'A guest participant has no user row. Adopting the identity model here would force every guest to be a degenerate user; the room translates instead.',
      },
    ],
  },
  {
    id: 'training',
    // `TrainingCheckpoint`, not `Checkpoint`: the canvas already owns that word
    // for a point in a board's history, and a training checkpoint is a set of
    // adapter weights. Same word, two meanings, two contexts — so the map spells
    // them apart rather than pretending one term covers both.
    terms: ['Dataset', 'Run', 'Adapter', 'TrainingCheckpoint'],
    roots: ['components/AITrainingPanel.tsx', 'components/FinetuneStudioPanel.tsx'],
    relationships: [
      {
        with: 'agents',
        kind: 'customerSupplier',
        why: 'A trained adapter is only worth producing if an agent can be pinned to it; the shape of a run is negotiated with the runtime, not imposed on it.',
      },
    ],
  },
  {
    id: 'inference',
    terms: ['Model', 'Provider', 'Route', 'Budget'],
    roots: ['lib/modelCatalog.ts', 'lib/useLlmModels.ts'],
    relationships: [
      {
        with: 'platform',
        kind: 'conformist',
        why: 'The gateway owns model identity and routing. A second client-side notion of "which model" is exactly the stale-pin defect canonicalModelId had to be added to repair.',
      },
    ],
  },
  {
    id: 'voice',
    terms: ['Voice', 'Enrollment', 'Utterance', 'Caption'],
    roots: ['lib/voiceEngine.ts', 'components/builder/VoiceConfigPanel.tsx'],
    relationships: [
      {
        with: 'people',
        kind: 'antiCorruption',
        why: 'An enrolled voice belongs to a person, but the voice context must not grow a copy of the people model to say so — it holds an enrollment id and translates.',
      },
    ],
  },
] as const;

// ── The Canvas aggregate ─────────────────────────────────────────────────────

/**
 * `CanvasBoard` is the AGGREGATE ROOT of the canvas context.
 *
 * Everything a board contains — objects, their positions, the selection, the
 * branch and checkpoint history — is reached through the board and changed
 * through the board. That is the whole point of naming one: an invariant that
 * spans two objects has exactly one place it can be checked.
 *
 * These are the invariants. They are stated here, in the context that owns them,
 * rather than implied by whichever callback happens to run.
 *
 * ── WHY THEY ARE KEYED AND NOT A BARE LIST ───────────────────────────────────
 * They used to be a positional array, which was fine while nothing imported
 * them. `domains/canvas/domain/canvasBoard.ts` now CHECKS them, and a check that
 * cites an invariant by list position is one insertion away from reporting the
 * wrong rule — the failure mode being a violation message that names a rule the
 * code did not test. The key is the citation; the string stays the single
 * wording, so a check and its message cannot drift into two statements of one
 * rule.
 *
 * `uniqueObjectIds` and `noDanglingConnection` are new here (2026-08-20) and are
 * not an expansion of scope: PRD 22 §4.4(a) states both in the same breath as
 * the aggregate root ("no edge may reference a missing node; node ids are unique
 * within the board") and the original five simply did not carry them across.
 * They are also the two a board can be checked against on its own, which is what
 * made their absence visible the moment anything ran the check.
 */
export const CANVAS_BOARD_INVARIANTS_BY_KEY = {
  declaredKind: 'Every object on the board has a kind the contract declares. An unknown kind is rejected at the boundary, never rendered as a blank card.',
  uniqueObjectIds: 'Object ids are unique within a board. Two objects sharing an id makes every operation that addresses one of them ambiguous.',
  noDanglingConnection: 'A connection joins two objects the board holds. An edge to a missing object is a line drawn from nowhere to nowhere.',
  selectionWithinBoard: 'The selection only ever names objects the board currently holds. Deleting an object removes it from the selection in the same change, not on the next render.',
  checkpointNamesRealState: 'A checkpoint names a board state that existed. Restoring one replaces the whole board, so a half-applied restore is not a state the board can be in.',
  singleLineOfHistory: 'A branch has exactly one parent checkpoint, and a checkpoint belongs to exactly one branch. A board is therefore always on a single, nameable line of history.',
  derivationNamesItsSource: 'A derived object names its source. The source is never mutated to satisfy a derivation — that is what makes the original safe to keep.',
} as const;

export type CanvasBoardInvariantKey = keyof typeof CANVAS_BOARD_INVARIANTS_BY_KEY;

/** The same statements as a list, for anything that only wants to read them. */
export const CANVAS_BOARD_INVARIANTS = Object.values(CANVAS_BOARD_INVARIANTS_BY_KEY);

/**
 * A COMMAND is an intent. Someone (or some agent) is ASKING the board to change.
 * It may be refused: the board validates it against the invariants above.
 *
 * ── WHY THIS TYPE IS SEPARATE FROM `CanvasEvent`, AND WHY IT MATTERS ─────────
 * PRD 22 §3.7 proposed broadcasting COMMANDS to collaborators. That is a
 * correctness bug, not a performance one. A command is a request whose outcome
 * depends on the state it is applied to, so every peer would independently
 * re-run validation against a board that is a few milliseconds different — and
 * two peers can legitimately reach DIFFERENT answers about the same command.
 * Once they have, nothing converges them: they are not out of sync by a frame,
 * they disagree about what happened.
 *
 * The fix is the ordinary one, and it is a type, not a discipline: a command is
 * validated by the aggregate and produces EVENTS; only events cross the wire.
 * An event is a fact — it has already happened, it cannot be refused, and
 * applying it is deterministic. `broadcastableCanvasChange` below is the only
 * sanctioned way to hand a change to the transport, and it accepts events only.
 */
export interface CanvasCommand<TKind extends string = string, TPayload = unknown> {
  readonly intent: TKind;
  readonly payload: TPayload;
  /** Who is asking. A command always has an asker; an event may not have one. */
  readonly actor: { kind: 'user' | 'agent' | 'system'; id: string | null };
}

/** A FACT. It happened, it is not refusable, and applying it is deterministic. */
export interface CanvasEvent<TKind extends string = string, TPayload = unknown> {
  readonly fact: TKind;
  readonly payload: TPayload;
  /** Monotonic per board. Two peers applying the same events in this order end
   *  on the same board, which is the property commands cannot provide. */
  readonly sequence: number;
  readonly at: string;
}

/**
 * The transport seam. Deliberately the only export shaped like "send this to the
 * other people": a `CanvasCommand` cannot be passed to it, so the §3.7 proposal
 * fails to compile rather than shipping and diverging in production.
 */
export function broadcastableCanvasChange<TKind extends string, TPayload>(
  event: CanvasEvent<TKind, TPayload>,
): CanvasEvent<TKind, TPayload> {
  return event;
}

/** Every term any context claims, for the glossary check. */
export function canvasGlossary(): string[] {
  return FRONTEND_CONTEXTS.flatMap((context) => [...context.terms]);
}
