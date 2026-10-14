/**
 * WHAT A FINISHED MEETING LEAVES ON THE BOARD — the pure decision.
 *
 * The canvas `standup` card is a launcher: starting it opens a `ceremony_sessions` row
 * and stamps the card `resourceId: 'ceremony:<id>'`. The record — transcript and AI
 * minutes — lives on the companion meeting. This function is the write-BACK: given a
 * board's graph and the meeting's minutes, it returns the board as it should read once
 * the meeting is over:
 *
 *   • every card for this ceremony gets the MINUTES' summary in place of the sentence
 *     it was convened with, and a held status;
 *   • each OPEN action item becomes a `task` card beside the card, joined to it by an
 *     `action item` connection.
 *
 * ── IDEMPOTENT ON A RESOURCE REF, NOT A TITLE ────────────────────────────────
 * Minutes are regenerated, and a regeneration rewords. Matching follow-ups by title
 * would leave the old wording on the board next to the new — one commitment, two cards.
 * So each follow-up carries its own resource ref, `ceremony_action:<ceremonyId>:<n>`
 * (n = its position among the open items), held unique per board by
 * `uq_creation_objects_resource`. A re-run UPDATES card n in place (keeping wherever
 * somebody dragged it and whatever else they set on it), places only the items that
 * are new, and removes the follow-ups the regenerated minutes no longer list. Running
 * it twice on the same minutes changes nothing at all, which is what lets the caller
 * skip the write entirely.
 *
 * Follow-ups placed by the retired browser act (no ref, `sourceCeremonyId` in their
 * content) are ADOPTED by title rather than duplicated, so a board that pulled minutes
 * the old way converges onto the new keys on the first sync.
 *
 * Pure: no database, no clock, ids injected — the use case in
 * `ceremonyMinutesToCanvas.ts` owns the reads and the write.
 */

import { formatResourceRef } from '@builderforce/creation-canvas-contract';
import { actionItemTitle, type MeetingMinutes } from '../../domain/meetings/meetingMinutes';
import type { GraphConnectionInput, GraphObjectInput } from '../creation/creationGraphWriter';
import type { BoardGraph } from '../canvas/rewriteBoardGraph';

/** The resource type a stand-up card carries once convened. */
export const CEREMONY_RESOURCE_TYPE = 'ceremony';
/** The resource type of a follow-up placed from a ceremony's minutes. */
export const CEREMONY_ACTION_RESOURCE_TYPE = 'ceremony_action';
/** The status a stand-up card shows once its minutes are on the board. */
export const CEREMONY_HELD_STATUS = 'Held';
/** The status a new follow-up starts in — the board's own default for a task card. */
const FOLLOW_UP_STATUS = 'Ready';
/** Content key for the list of deleted action-item resource ids (tombstones). */
export const DELETED_ACTION_ITEMS_KEY = 'deletedActionItemResourceIds';

/**
 * Adds a tombstone for a deleted ceremony_action follow-up to the card's content.
 * This prevents the follow-up from being re-created on the next minutes sync.
 *
 * @param cardContent - The current content of the ceremony card (with resourceId: ceremony:<id>)
 * @param deletedResourceId - The resource id of the deleted action item (e.g., "ceremonyId:1")
 * @returns Updated content with the tombstone added (if not already present)
 */
export function addDeletedActionItemTombstone(
  cardContent: Record<string, unknown>,
  deletedResourceId: string,
): Record<string, unknown> {
  const existing = Array.isArray(cardContent[DELETED_ACTION_ITEMS_KEY])
    ? (cardContent[DELETED_ACTION_ITEMS_KEY] as string[])
    : [];
  if (existing.includes(deletedResourceId)) {
    // Already in the tombstone list, no change needed
    return cardContent;
  }
  return { ...cardContent, [DELETED_ACTION_ITEMS_KEY]: [...existing, deletedResourceId] };
}

/** Where follow-ups go relative to the card: one column to its right. */
const FOLLOW_UP_OFFSET_X = 420;
const FOLLOW_UP_STEP_Y = 170;
const FOLLOW_UP_EDGE_LABEL = 'action item';

/** The follow-up resource id for open item `index` (0-based) of a ceremony's minutes. */
export function ceremonyActionResourceId(ceremonyId: string, index: number): string {
  return `${ceremonyId}:${index + 1}`;
}

export interface CeremonyMinutesWriteBack {
  ceremonyId: string;
  minutes: MeetingMinutes;
  /** `meetings.summary_generated_at`, ISO — stamped on the card so a reader can tell
   *  WHICH minutes it shows, and so a re-run on the same minutes is a no-op. */
  generatedAt: string | null;
  /** Mints ids for new objects and connections (injected so tests are deterministic). */
  newId: () => string;
}

export interface CeremonyMinutesBoardResult {
  graph: BoardGraph;
  /** Stand-up cards whose content changed. */
  cards: number;
  placed: number;
  updated: number;
  removed: number;
  /** Open action items the minutes listed. */
  actionItems: number;
  changed: boolean;
}

type Content = Record<string, unknown>;

function contentOf(object: GraphObjectInput): Content {
  const content = object.content;
  return content && typeof content === 'object' && !Array.isArray(content) ? content as Content : {};
}

function positionOf(object: GraphObjectInput): { x: number; y: number } {
  const data = (object.canvasData ?? {}) as { x?: unknown; y?: unknown };
  const x = Number(data.x);
  const y = Number(data.y);
  return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
}

/** Compare titles the way a person would: case and surrounding space are not a difference. */
function titleKey(text: unknown): string {
  return String(text ?? '').trim().toLowerCase();
}

/** Stable comparison of two content objects, so "nothing changed" is detectable. */
function sameContent(a: Content, b: Content): boolean {
  const canonical = (value: Content) => JSON.stringify(Object.keys(value).sort().map((key) => [key, value[key]]));
  return canonical(a) === canonical(b);
}

/**
 * The board after this ceremony's minutes are applied, or null when the board holds no
 * card for this ceremony (nothing to write back to).
 */
export function applyCeremonyMinutesToBoard(
  graph: BoardGraph,
  input: CeremonyMinutesWriteBack,
): CeremonyMinutesBoardResult | null {
  const { ceremonyId, minutes } = input;
  const isCard = (object: GraphObjectInput) =>
    object.resourceType === CEREMONY_RESOURCE_TYPE && object.resourceId === ceremonyId;
  const anchor = graph.objects.find(isCard);
  if (!anchor) return null;

  // Tombstones: resource ids of action items the user manually deleted.
  // These are stored in the card's content so they persist across syncs.
  const anchorContent = contentOf(anchor);
  const deletedActionItemResourceIds = Array.isArray(anchorContent[DELETED_ACTION_ITEMS_KEY])
    ? (anchorContent[DELETED_ACTION_ITEMS_KEY] as string[])
    : [];

  const followUpPrefix = `${ceremonyId}:`;
  const isOwnFollowUp = (object: GraphObjectInput) =>
    object.resourceType === CEREMONY_ACTION_RESOURCE_TYPE && typeof object.resourceId === 'string'
    && object.resourceId.startsWith(followUpPrefix);

  // Legacy follow-ups (placed in the browser, no ref) adoptable by title — first wins.
  const legacy = new Map<string, GraphObjectInput>();
  for (const object of graph.objects) {
    if (object.kind !== 'task' || object.resourceId) continue;
    const content = contentOf(object);
    if (content.sourceCeremonyId !== ceremonyId) continue;
    const key = titleKey(content.title);
    if (key && !legacy.has(key)) legacy.set(key, object);
  }
  const owned = new Map(graph.objects.filter(isOwnFollowUp).map((object) => [object.resourceId as string, object]));

  // A ticked item was dealt with in the room; placing it would hand the team work they
  // have just reported finished.
  const open = minutes.actionItems.filter((item) => !item.done);
  const anchorAt = positionOf(anchor);

  let cards = 0;
  let placed = 0;
  let updated = 0;
  const replaced = new Map<string, GraphObjectInput>();
  const added: GraphObjectInput[] = [];
  const addedEdges: GraphConnectionInput[] = [];
  const kept = new Set<string>();

  // 1. The stand-up card(s): the minutes' recap replaces the convening sentence.
  for (const card of graph.objects.filter(isCard)) {
    const before = contentOf(card);
    const after: Content = { ...before, status: CEREMONY_HELD_STATUS };
    // REPLACED, never kept: the sentence the card was convened with promises a meeting
    // that has now happened. Minutes with no recap clear it rather than leave it.
    if (minutes.summary) after.summary = minutes.summary;
    else delete after.summary;
    if (input.generatedAt) after.minutesGeneratedAt = input.generatedAt;
    // Preserve the tombstone list (it may be empty, which is fine).
    after[DELETED_ACTION_ITEMS_KEY] = deletedActionItemResourceIds;
    if (!sameContent(before, after)) { replaced.set(card.id, { ...card, content: after }); cards += 1; }
  }

  // 2. The follow-ups: update in place by ref, adopt a legacy card by title, else place.
  // Skip any item whose resource id is in the tombstone list (manually deleted by user).
  open.forEach((item, index) => {
    const resourceId = ceremonyActionResourceId(ceremonyId, index);
    // Skip tombstones: user deleted this action item, do not re-create it.
    if (deletedActionItemResourceIds.includes(resourceId)) return;
    const title = actionItemTitle(item);
    const ref = formatResourceRef(CEREMONY_ACTION_RESOURCE_TYPE, resourceId);
    const existing = owned.get(resourceId) ?? legacy.get(titleKey(title));
    if (existing) {
      legacy.delete(titleKey(contentOf(existing).title));
      kept.add(existing.id);
      const before = contentOf(existing);
      const after: Content = { ...before, kind: 'task', title, sourceCeremonyId: ceremonyId, resourceId: ref };
      // The owner follows the minutes: a regeneration that drops the name drops it here.
      if (item.owner) after.subtitle = item.owner;
      else delete after.subtitle;
      const refChanged = existing.resourceType !== CEREMONY_ACTION_RESOURCE_TYPE || existing.resourceId !== resourceId;
      if (refChanged || !sameContent(before, after)) {
        replaced.set(existing.id, { ...existing, resourceType: CEREMONY_ACTION_RESOURCE_TYPE, resourceId, content: after });
        updated += 1;
      }
      return;
    }
    const id = input.newId();
    added.push({
      id,
      kind: 'task',
      resourceType: CEREMONY_ACTION_RESOURCE_TYPE,
      resourceId,
      canvasData: { x: anchorAt.x + FOLLOW_UP_OFFSET_X, y: anchorAt.y + index * FOLLOW_UP_STEP_Y },
      content: {
        kind: 'task',
        title,
        status: FOLLOW_UP_STATUS,
        // The owner is the name the minutes used, kept as written. Resolving it to a
        // member would be a guess made silently on somebody's behalf; the task drawer's
        // assignee picker is where a person makes it, seeing who they picked.
        ...(item.owner ? { subtitle: item.owner } : {}),
        // Where it came from, so a task nobody remembers agreeing to can be traced back.
        sourceCeremonyId: ceremonyId,
        resourceId: ref,
      },
    });
    addedEdges.push({
      id: input.newId(),
      sourceObjectId: anchor.id,
      targetObjectId: id,
      kind: 'reference',
      label: FOLLOW_UP_EDGE_LABEL,
      metadata: { animated: false, rendererType: 'smoothstep' },
    });
    placed += 1;
  });

  // 3. Follow-ups the regenerated minutes no longer list go, with their connections.
  const removedIds = new Set([...owned.values()].filter((object) => !kept.has(object.id)).map((object) => object.id));
  const removed = removedIds.size;

  const objects = [
    ...graph.objects.filter((object) => !removedIds.has(object.id)).map((object) => replaced.get(object.id) ?? object),
    ...added,
  ];
  const connections = [
    ...graph.connections.filter((edge) => !removedIds.has(edge.sourceObjectId) && !removedIds.has(edge.targetObjectId)),
    ...addedEdges,
  ];

  return {
    graph: { objects, connections },
    cards,
    placed,
    updated,
    removed,
    actionItems: open.length,
    changed: cards + placed + updated + removed > 0,
  };
}
