import { isCreationObjectKind } from '@builderforce/creation-canvas-contract';
import { patchWithProvenance, type Actor } from '@/lib/canvasApprovalGate';
import type { CanvasWidgetRecord } from '@/lib/canvasWidgetApi';
import type { WidgetHostBridge, WidgetItem, WidgetWriteResult } from '@/lib/canvasWidgetHost';
import type { CanvasBoardBridge } from '@/components/creation-canvas/canvasBoardBridge';
import { sanitizeCreationObjectPatch } from '@/components/creation-canvas/creationObjectRegistry';

/**
 * One widget placement's view of the board — the {@link WidgetHostBridge} the message
 * table talks to, built from the canvas's own {@link CanvasBoardBridge}.
 *
 * ── WHAT A WIDGET MAY NOT DO, EVEN WITH `item:write` ─────────────────────────
 * `item:write` is granted blind at install time, so the write path is narrower than
 * a person's in the four places where a third party could turn a write into a
 * takeover:
 *  • FIELDS go through `sanitizeCreationObjectPatch` for the object's kind — the same
 *    registry that bounds a model's writes. A widget cannot invent a field.
 *  • The TRUST FIELDS are stripped outright: `resourceId` (re-pointing a placement at
 *    another widget would hand this frame's trust to a different origin), `kind`,
 *    `provenance`, `approvalMode` (a widget declaring its own act "autonomous" is the
 *    gate opening itself) and `widgetStorage` (another widget's private blob).
 *  • Every attributed figure it moves is STAMPED — `patchWithProvenance`, actor
 *    `agent`, so the approval desk shows "Stripe widget moved amount from … to …" and
 *    the gate treats it exactly as it treats a model's change: waiting for a person.
 *  • It may not delete its own placement. `widget.close` is how a widget leaves.
 */

const PROTECTED_FIELDS = ['resourceId', 'kind', 'provenance', 'approvalMode', 'widgetStorage'] as const;

function withoutProtected(patch: Record<string, unknown>): Record<string, unknown> {
  const next = { ...patch };
  for (const field of PROTECTED_FIELDS) delete next[field];
  return next;
}

export function widgetActor(widget: Pick<CanvasWidgetRecord, 'key' | 'name'>): Actor {
  return { kind: 'agent', ref: `widget:${widget.key}`, name: widget.name };
}

const READ_ONLY: WidgetWriteResult = { ok: false, error: 'This board is read-only for the current viewer' };
const NOT_FOUND: WidgetWriteResult = { ok: false, error: 'No such item on this board' };

export function widgetBoardBridge(
  board: CanvasBoardBridge,
  placementId: string,
  widget: Pick<CanvasWidgetRecord, 'key' | 'name'>,
  now: () => string = () => new Date().toISOString(),
): WidgetHostBridge {
  const find = (id: string) => board.objects.find((object) => object.id === id);
  const placement = () => find(placementId);
  return {
    board: () => ({ id: board.sessionId, title: board.title }),
    items: () => board.objects.map((object): WidgetItem => ({
      id: object.id,
      kind: object.data.kind,
      title: typeof object.data.title === 'string' ? object.data.title : '',
      ...(typeof object.data.status === 'string' ? { status: object.data.status } : {}),
      position: { x: object.position.x, y: object.position.y },
    })),
    createItem: ({ kind, title, data }) => {
      if (!board.edits) return READ_ONLY;
      if (!isCreationObjectKind(kind)) return { ok: false, error: `Unknown kind: ${kind}` };
      const fields = { ...sanitizeCreationObjectPatch(kind, withoutProtected(data ?? {})), ...(title ? { title } : {}) };
      const near = placement()?.position;
      return { ok: true, id: board.edits.add(kind, fields, near ? { x: near.x + 48, y: near.y + 48 } : undefined) };
    },
    updateItem: (id, patch) => {
      if (!board.edits) return READ_ONLY;
      const target = find(id);
      if (!target) return NOT_FOUND;
      const clean = sanitizeCreationObjectPatch(target.data.kind, withoutProtected(patch)) as Record<string, unknown>;
      if (!Object.keys(clean).length) return { ok: false, error: 'Nothing in that patch can be written to this item' };
      board.edits.patch(id, patchWithProvenance(target.data, clean, widgetActor(widget), now(), `Widget ${widget.name}`));
      return { ok: true, id };
    },
    deleteItem: (id) => {
      if (!board.edits) return READ_ONLY;
      if (id === placementId) return { ok: false, error: 'A widget cannot delete its own placement — send widget.close' };
      if (!find(id)) return NOT_FOUND;
      board.edits.remove([id]);
      return { ok: true, id };
    },
    user: () => (board.viewer ? { displayName: board.viewer.displayName } : null),
    storage: () => {
      const stored = placement()?.data.widgetStorage;
      return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored as Record<string, unknown> : {};
    },
    setStorage: (value) => {
      if (!board.edits) return READ_ONLY;
      if (!placement()) return NOT_FOUND;
      board.edits.patch(placementId, { widgetStorage: value });
      return { ok: true };
    },
    notify: (message) => board.notice(`${widget.name}: ${message}`),
  };
}
