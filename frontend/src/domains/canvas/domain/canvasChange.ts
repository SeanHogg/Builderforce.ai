/**
 * PROPOSED CHANGES — the command side of the canvas aggregate.
 *
 * `lib/canvas/boundedContexts.ts` draws the line this module sits on: a
 * `CanvasCommand` is an INTENT and may be refused; a `CanvasEvent` is a FACT and
 * may be broadcast. A `ProposedCanvasChange` is the intent shape the Brain turn
 * produces — a list of things a model would like the board to become — and
 * everything here is about deciding which of them the board is willing to apply
 * without asking a human first.
 *
 * It lives in the domain because that decision is a RULE about the board, not a
 * property of the panel that renders the review list. It was previously a pair
 * of functions inside an 11,000-line component, which is why the same judgement
 * ("is this reversible?") had to be re-made by eye every time a kind gained an
 * action.
 */

import type { Edge } from '@xyflow/react';
import type { CreationConnectionKind } from '@builderforce/creation-canvas-contract';
import type { CanvasObject, CanvasObjectData, CreationObjectKind } from './canvasObject';

export type ProposedCanvasChange =
  | { id: string; type: 'object.add'; label: string; node: CanvasObject }
  | { id: string; type: 'object.update'; label: string; objectId: string; patch: Partial<CanvasObjectData> }
  | { id: string; type: 'object.delete'; label: string; objectId: string }
  | { id: string; type: 'object.layout'; label: string; objectId: string; position?: { x: number; y: number }; width?: number; height?: number; hidden?: boolean; locked?: boolean }
  | { id: string; type: 'object.action'; label: string; objectId: string; action: string }
  | { id: string; type: 'connection.add'; label: string; edge: Edge }
  | { id: string; type: 'connection.update'; label: string; connectionId: string; patch: { label?: string; kind?: CreationConnectionKind } }
  | { id: string; type: 'connection.delete'; label: string; connectionId: string };

/**
 * Canvas-local authoring is reversible and is the direct result the user asked
 * Brain to create, so it must not stop behind a second approval step. Keep
 * destructive operations, executable actions, and canonical PRD persistence in
 * review. Those can remove data, trigger work, or write outside the canvas.
 */
export function canvasChangesCanAutoApply(changes: readonly ProposedCanvasChange[]): boolean {
  return changes.length > 0 && changes.every((change) => {
    if (change.type === 'object.add') return change.node.data.canonicalPrdPending !== true;
    return change.type === 'object.update'
      || change.type === 'object.layout'
      || change.type === 'connection.add'
      || change.type === 'connection.update';
  });
}

/**
 * The acts a kind can actually PERFORM on this canvas.
 *
 * ── WHY THIS LIST IS THE POINT ───────────────────────────────────────────────
 * The object contract advertises capabilities; this says which of them have a
 * real Canvas-side adapter behind them. A kind listed here without one produces
 * the honest-but-useless "no delivery adapter is connected" answer forever,
 * which is worse than not advertising the act at all — the user is told the
 * platform can do a thing and then told it cannot, by the same platform, one
 * click apart.
 */
export const CONNECTED_CANVAS_ACTIONS: Partial<Record<CreationObjectKind, readonly string[]>> = {
  website: ['publish'], video: ['generate'], build: ['open'],
  // `build` compiles the authored steps into a real workflow definition; `run`
  // executes one. Run builds first when needed, so Brain can call either.
  workflow: ['build', 'run'], dataset: ['visualize', 'plot', 'profile'], project: ['expand', 'compare'],
  // `start` convenes the ceremony; `minutes` reads back what it produced and places the
  // meeting's action items on the board. Both are connected — the board could open a
  // stand-up and never read one, which is why the second is here.
  mockup: ['deliver'], mockupSet: ['expand', 'deliver'], standup: ['start', 'minutes'],
  evermind: ['train', 'evaluate', 'publish'],
  // The facilitation acts. All four are CONNECTED: `publish` mints the join address and
  // opens voting, and the other three steer a live poll through the same endpoint the
  // surface's buttons use. Nothing here is advertised without an adapter — the failure
  // this list exists to prevent.
  poll: ['publish', 'open', 'close', 'reveal'],
  image: ['generate', 'preview', 'export', 'convert-to-diagram'], drawing: ['convert-to-diagram'], diagram: ['convert-to-diagram'], animation: ['generate', 'preview', 'export'], podcast: ['generate', 'preview', 'export'],
  comic: ['generate', 'preview', 'export'], game: ['generate', 'preview', 'export'], cad: ['generate', 'preview', 'export', 'convert-to-diagram'], model3d: ['generate', 'preview', 'export'],
  resume: ['generate', 'preview', 'export'], template: ['browse', 'apply'],
  // The QA objects. `gate` recomputes the plan's verdict from the runs, defects and
  // audits on the board; `export` writes the .spec.ts (a plan writes its whole suite
  // as one file). Nothing else is advertised, because nothing else is connected —
  // running a suite is `canvas_publish_tests`, and a kind that advertised `run` here
  // would produce the honest-but-useless "no delivery adapter" answer forever.
  testPlan: ['gate', 'export'], testCase: ['export'], testRun: ['export'], defect: ['export'],
  // The monthly update, actually sent — over the SAME transports a campaign uses
  // (platform sender, the tenant's connected mailbox, or their SendGrid
  // connection). It stays a GATED action in `canvasApprovalGate`, so a model
  // cannot fire it: what changed is that a human who approves it now gets a send
  // instead of "no delivery adapter is connected".
  investorUpdate: ['send'],
  // The receivable's three acts (FO-C2). They were advertised by the spec, named
  // by the approval gate as irreversible or attested, and answered "no delivery
  // adapter is connected" for every one of them — the same state the three BILL
  // acts were in before 0469. `issue` freezes the figures, mints the customer's
  // own link, prices the way to pay it against this workspace's merchant account
  // and sends it; `record-payment` lands a receipt on the ledger idempotently;
  // `chase` climbs one rung of the collections ladder through the SAME function
  // the nightly sweep uses, so there is one collections history and not two.
  invoice: ['issue', 'record-payment', 'chase'],
  // Read the runs a connected payroll provider actually ran. `sync` and not `run`:
  // this platform must never calculate a salary — see the kind's own note.
  payRun: ['sync'],
  // The assessment cycle. `distribute` fans an assignment into one `submission` per
  // roster row; `compute` surfaces the gradebook's already-live derivation as a
  // reported figure; `mark` applies the rubric to a submission's authored
  // `placements` and, when the assignment is LTI-bound, pushes the score through
  // AGS; `import` pulls a cohort's roster from a connected LMS through NRPS (a CSV
  // paste goes through the dedicated `canvas_import_roster` tool instead, since this
  // generic action carries no text); `validate` checks a curriculum map's mapping
  // grid for outcomes and columns that do not resolve on the board.
  assignment: ['distribute'], gradebook: ['compute'], submission: ['mark'],
  cohort: ['import'], curriculumMap: ['validate'], bibliography: ['import'],
  // FO-B3's five consumers are NOT here, deliberately — see `DEDICATED_ACTION_TOOLS`.
  // Each is performed by a tool that takes arguments this generic seam cannot
  // carry, and listing them here made `canvas_invoke_object_action` stage a proposal
  // the pending-action dispatcher had no branch for: an approved `contract.sign` ended
  // in "no delivery adapter is connected" while the adapter it named sat one tool away.
  // FO-D1..FO-D4: the ownership acts, each of which reaches the real ledger.
  // `capTable.sync` FOLDS it onto the card and `model` prices a round against it;
  // `equityGrant.issue` and `convertible.record` WRITE it, and both stay GATED in
  // `canvasApprovalGate` — what changed is that a human who approves either now
  // gets a real event instead of a number typed onto a card.
  capTable: ['sync', 'model'], equityGrant: ['issue', 'sync'], convertible: ['record', 'model'],
  // THE HANDOVER. `offer.send` and `offer.sign` are performed by
  // `canvas_request_signature` (see `DEDICATED_ACTION_TOOLS`); `hire` is the third
  // act and the one that ends the funnel — a signed offer becomes an `employee` and an
  // onboarding `employeeLifecycle`, which is the transition both vocabularies described
  // in prose and neither performed.
  offer: ['hire'],
};

/** True only when an advertised capability has a real Canvas-side adapter.
 *  `inspect` and `edit` are unconditional: every object can be looked at and
 *  changed, and that is a property of being on the board rather than of a kind. */
export function canInvokeCreationObjectAction(kind: CreationObjectKind, action: string): boolean {
  return action === 'inspect' || action === 'edit' || CONNECTED_CANVAS_ACTIONS[kind]?.includes(action) === true;
}
