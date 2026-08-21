/**
 * A CARD ACT — the thing a card DOES, as data rather than as another branch.
 *
 * ── THE SHAPE THAT WAS WRITTEN THIRTEEN TIMES ────────────────────────────────
 * `CanvasInner` held a callback per act — `computeGradebook`, `markSubmission`,
 * `runInvoiceAction`, `hireFromOffer`, `syncPayRunCard`, and nine more — and
 * every one of them was the same seven steps in the same order:
 *
 *     find the card by id AND kind        → return if it is not there
 *     refuse if this needs an account     → notice, return
 *     read and validate its own fields    → notice, return
 *     do the work                         → may fail, notice
 *     stamp the result back onto the card
 *     sometimes place new cards beside it
 *     say what happened
 *
 * Six of those seven steps are IDENTICAL every time. Written thirteen times they
 * drifted: some acts checked `persistence !== 'server'` and some forgot, some
 * stamped the result onto the card and some left it to a toast the user is about
 * to dismiss, and the dispatch that reached them was a fifty-line `else if`
 * chain keyed on `kind` and `action` — the exact "new branch per case" the
 * architecture rules name, in the one place where forgetting a branch means an
 * advertised action answers "no delivery adapter is connected".
 *
 * So an act is now a REGISTRY ENTRY. It declares which kind and which actions it
 * answers, whether it needs an account, and one function that returns a
 * DESCRIPTION of what should change. Adding an act is data; the dispatch never
 * grows another branch, and the six shared steps have one implementation.
 *
 * ── WHY THE ACTS THEMSELVES ARE NOT IN THIS FOLDER ───────────────────────────
 * They belong to other bounded contexts. `invoice.issue` is finance,
 * `offer.hire` is hiring, `submission.mark` is teaching — and PRD 22 §3.4 says
 * so explicitly: `CanvasInner` was "the implementation site for use cases
 * belonging to other bounded contexts entirely". The canvas owns the SHAPE of an
 * act and the board it runs against; each context owns what its own act means,
 * in `domains/<context>/application/`.
 */

import type { Edge } from '@xyflow/react';
import type { CanvasObject, CanvasObjectData, CreationObjectKind } from '../domain/canvasObject';
import type { CanvasTextTranslator } from '../domain/canvasText';
import type { CanvasObjectFactory } from './MaterializeDataset';

/**
 * The board an act reads.
 *
 * Read-only and passed in, not reached for: an act that could call `setNodes`
 * would be a second place the graph is mutated, which is the defect PRD 22 §3.4
 * opened with. `create` is the object factory, injected for the same reason
 * `MaterializeDataset` takes one — the defaults come from the object registry,
 * which lives in `components/`.
 */
export interface CardActBoard {
  objects: readonly CanvasObject[];
  create: CanvasObjectFactory;
}

export interface CardActContext {
  /** The card the act was invoked on, already matched on kind. */
  object: CanvasObject;
  /** Which act — `invoice` answers three, so the entry needs to know. */
  action: string;
  board: CardActBoard;
  t: CanvasTextTranslator;
}

/**
 * What an act decided. Every field optional except the sentence.
 *
 * The NOTICE is mandatory on purpose: an act that changes something and says
 * nothing is indistinguishable from a button that does not work, and half the
 * originals reached that state down at least one branch.
 */
export interface CardActOutcome {
  /** Fields to write back onto the card the act ran on. */
  patch?: Partial<CanvasObjectData>;
  /** Cards and connections to place. */
  add?: { nodes: CanvasObject[]; edges: Edge[] };
  /** What to tell the person. */
  notice: string;
  /**
   * A slower half that finishes after the notice — pushing a mark to an LMS, say
   * — resolving to the sentence that should replace it.
   *
   * Modelled rather than left to a floating `.then` because a promise nobody
   * awaits is a promise nobody can test, and this one carries the answer to "did
   * the grade actually reach the gradebook the student reads".
   */
  settle?: Promise<string>;
}

export interface CardAct {
  kind: CreationObjectKind;
  /** The actions this entry answers. Omit for "every action on this kind". */
  actions?: readonly string[];
  /**
   * The notice key to show when this act needs a server-backed session and the
   * board is a local draft. A KEY rather than a boolean because each act says it
   * in its own words ("Sign in to send this update", "…to issue an invoice"), and
   * a shared sentence for all of them would be the vaguer one.
   */
  accountRequired?: string;
  /**
   * The notice key for a throw with no message of its own. Each act keeps the
   * sentence it always had ("Could not sync the pay run"), because "something
   * went wrong" on a payroll card and on a bibliography card are not the same
   * amount of alarming.
   */
  failureNotice?: string;
  run(context: CardActContext): CardActOutcome | Promise<CardActOutcome>;
}

/** The act that answers this card and action, or nothing. */
export function cardActFor(acts: readonly CardAct[], kind: CreationObjectKind, action: string): CardAct | undefined {
  return acts.find((act) => act.kind === kind && (!act.actions || act.actions.includes(action)));
}

export interface RunCardActInput {
  objectId: string;
  action: string;
  board: CardActBoard;
  /** `'local'` is a draft on this device with no server behind it. */
  persistence: 'local' | 'server';
  t: CanvasTextTranslator;
}

/**
 * Run the act this card and action name, and return what should change.
 *
 * `null` means "no act answered this" — the caller's cue to say so, which is the
 * one honest answer for an action a kind advertises and nothing implements.
 * A THROW is caught and turned into a notice, because every original wrapped its
 * network call in the same `try`/`catch` and two of them did not.
 */
export async function runCardAct(
  acts: readonly CardAct[],
  { objectId, action, board, persistence, t }: RunCardActInput,
): Promise<CardActOutcome | null> {
  const object = board.objects.find((candidate) => candidate.id === objectId);
  if (!object) return null;
  const act = cardActFor(acts, object.data.kind, action);
  if (!act) return null;
  if (act.accountRequired && persistence !== 'server') return { notice: t(act.accountRequired) };
  try {
    return await act.run({ object, action, board, t });
  } catch (error) {
    if (error instanceof Error && error.message) return { notice: error.message };
    // The act's own sentence takes no placeholders; the generic fallback names
    // what was attempted, because "something went wrong" with no subject is the
    // least useful thing a status line can say.
    return act.failureNotice
      ? { notice: t(act.failureNotice) }
      : { notice: t('noticeNoDeliveryAdapter', { action, kind: object.data.kind }) };
  }
}

/** A trimmed string field off a card, or `''`. The single most repeated line in
 *  the originals, spelled four different ways between them. */
export function cardText(data: Record<string, unknown>, field: string): string {
  const value = data[field];
  return typeof value === 'string' ? value.trim() : '';
}

/** The rows a card holds under a field, as an array whatever it actually is. */
export function cardRows(data: Record<string, unknown>, field: string): Record<string, unknown>[] {
  const value = data[field];
  return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object') : [];
}

/**
 * A connection from the card an act ran on to a card it placed.
 *
 * The four acts that create objects each wrote this literal, and one of them
 * omitted `connectionKind` — so the board's critical path and coverage figures
 * silently skipped the edge, because those read `kind` and it defaulted.
 */
export function actEdge(from: CanvasObject, to: CanvasObject, label: string, connectionKind: string): Edge {
  return { id: crypto.randomUUID(), source: from.id, target: to.id, type: 'smoothstep', label, data: { connectionKind } };
}
