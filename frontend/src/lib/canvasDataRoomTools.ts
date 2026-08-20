/**
 * The data room's canvas vocabulary — sync it, share it, revoke it (FO-E2).
 *
 * ── THE GAP THESE CLOSE ──────────────────────────────────────────────────────
 * `dataRoom.share` was declared in `founderObjects.ts`, advertised to the model as
 * connected (`CONNECTED_CANVAS_ACTIONS`) and GATED in `canvasApprovalGate` — and
 * there was nothing behind the gate. A human could approve the act and no link was
 * minted, no NDA was sent and nothing was logged. The card's `ndaState` and
 * `ndaSignatureRequestId` were declared as "written by the share flow" by a share
 * flow that did not exist.
 *
 * The room's own safety columns were in the same state one layer down:
 * `data_rooms.nda_required`, `.watermark` and `.expires_at` had no reader anywhere
 * in the codebase. All three are now enforced in `dataRoomSharing.ts`, at the one
 * place a token is resolved.
 *
 * ── WHY DEDICATED TOOLS AND NOT `canvas_invoke_object_action` ────────────────
 * Same argument as `canvasLegalDocumentTools.ts` and `canvasSellMotionTools.ts`:
 * `share` carries ARGUMENTS — a named recipient, a real address, an expiry, a
 * purpose — and the generic action tool takes an object id and a verb and nothing
 * else. So the approval gate is re-evaluated HERE, against the same `dataRoom.share`
 * entry `canvas_invoke_object_action` would have checked, rather than bypassed.
 *
 * ── WHY THE CARD IS A PROJECTION ─────────────────────────────────────────────
 * `canvas_sync_data_room` overwrites the card from the workspace's own rooms:
 * `readiness` is COMPUTED from required-versus-provided rather than typed,
 * `documents` are the real diligence obligations (including the missing ones — a
 * room that lists only what exists hides the gap it was built to close), and the
 * shares and view counts are read, never asserted. Same direction as the pipeline
 * projection, for the same reason.
 */

import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import { evaluateGate, readProvenance, type ApprovalMode } from '@/lib/canvasApprovalGate';
import type { CanvasFounderOpsContext } from '@/lib/canvasFounderOpsTools';
import {
  dataRoomAnalytics,
  dataRoomShares,
  listDataRooms,
  revokeDataRoomShare,
  setLegalDocumentDataRoom,
  shareDataRoom,
  type DataRoomAnalytics,
  type DataRoomShareSummary,
  type DataRoomSummary,
} from '@/lib/founderOpsApi';

const NO_TENANT = 'This needs a signed-in, saved canvas session: a data room is a real workspace record with real recipients, and an anonymous board has none. Say so in one sentence and keep building what this canvas can hold; never claim it ran.';

/** Beyond this a card is a document register, not a room. The rest are counted. */
const MAX_ROWS = 40;

/**
 * The canvas `dataRoom` fields one real room projects to.
 *
 * `readiness` and the two counts are DERIVED server-side and written here — never
 * authored, which is the whole difference between a meter that means something and
 * a number somebody typed once.
 */
export function dataRoomFieldsFrom(
  room: DataRoomSummary,
  shares: DataRoomShareSummary[],
  analytics: DataRoomAnalytics | null,
): Record<string, unknown> {
  const active = shares.filter((share) => share.state === 'active');
  return {
    title: room.name,
    status: room.status,
    dataRoomId: room.id,
    ...(room.purpose ? { audience: room.purpose } : {}),
    readiness: room.readiness,
    ndaRequired: room.ndaRequired,
    watermark: room.watermark,
    expiresAt: room.expiresAt ? room.expiresAt.slice(0, 10) : '',
    documents: room.documents.slice(0, MAX_ROWS).map((document) => ({
      document: document.label,
      category: document.category,
      // The obligation's own word where the file is there, and "missing" where it
      // is not — the row a diligence list exists to surface.
      status: document.available ? document.status : 'missing',
      owner: '',
      required: document.required ? 'yes' : 'no',
      // Which of the two shapes this row is — an outstanding obligation, or an
      // encrypted legal file that has actually been filed into the room.
      source: document.source,
      documentId: document.documentId,
    })),
    unstampable: room.unstampable,
    shares: shares.slice(0, MAX_ROWS).map((share) => ({
      recipient: share.recipientName ?? share.recipientEmail ?? '',
      email: share.recipientEmail ?? '',
      access: share.permission,
      nda: share.ndaState,
      state: share.state,
      expires: share.expiresAt ? share.expiresAt.slice(0, 10) : '',
      shareId: share.shareId,
    })),
    views: (analytics?.documents ?? []).slice(0, MAX_ROWS).map((row) => ({
      document: row.label,
      views: row.views,
      lastViewedAt: row.lastViewedAt ? row.lastViewedAt.slice(0, 16).replace('T', ' ') : '',
    })),
    summary:
      `${room.readiness}% of required documents provided. `
      + `${active.length} live link${active.length === 1 ? '' : 's'}, `
      + `${analytics?.opens ?? room.opens} open${(analytics?.opens ?? room.opens) === 1 ? '' : 's'} and `
      + `${analytics?.documentViews ?? room.documentViews} document view${(analytics?.documentViews ?? room.documentViews) === 1 ? '' : 's'} recorded. `
      + `${room.ndaRequired ? 'An NDA is required before the room opens.' : 'No NDA is required.'} `
      + `${room.watermark
        ? `Documents are watermarked — every page a firm opens is stamped with their address and the time${room.unstampable > 0 ? `, except ${room.unstampable} whose format cannot carry a stamp and are served view-only` : ''}.`
        : 'Downloads are permitted.'} `
      + 'This card is a view of the room, not a second copy of it — share it with canvas_share_data_room rather than editing the rows.',
  };
}

export function canvasDataRoomActions(ctx: CanvasFounderOpsContext): BrainAction[] {
  const guard = (): { error: string } | null => {
    if (!ctx.hasTenant) return { error: NO_TENANT };
    if (!ctx.canEdit) return { error: 'The current session role cannot edit this canvas' };
    return null;
  };

  /** The `dataRoom` card this call is about, and the workspace room behind it.
   *  Matched on `dataRoomId` — the id is the identity, and matching on a title is
   *  the defect every projection in this family removes. */
  const resolveRoom = async (args: { objectId?: string; dataRoomId?: number; name?: string }) => {
    const rooms = await listDataRooms();
    if (!rooms.length) return { rooms, room: null, object: null };
    const objects = ctx.objects().filter((object) => object.kind === 'dataRoom');
    const object = args.objectId ? objects.find((candidate) => candidate.id === args.objectId) : null;
    const declaredId = Number(args.dataRoomId ?? (object ? object.data.dataRoomId : undefined));
    const needle = args.name?.trim().toLowerCase();
    const room = rooms.find((candidate) => candidate.id === declaredId)
      ?? (needle ? rooms.find((candidate) => candidate.name.toLowerCase().includes(needle)) : undefined)
      ?? (rooms.length === 1 ? rooms[0] : undefined)
      ?? null;
    const card = object
      ?? (room ? objects.find((candidate) => Number(candidate.data.dataRoomId) === room.id) : undefined)
      ?? null;
    return { rooms, room, object: card };
  };

  return [
    {
      name: 'canvas_sync_data_room',
      description:
        'Put the workspace\'s REAL data room on the canvas as a `dataRoom` object — the diligence documents it requires (including the ones still MISSING), how ready it is, who currently holds a link, whether their NDA is signed, and what they have actually read. Call this before answering anything about diligence, readiness or who has seen what, and instead of authoring document rows by hand. The card this writes is a VIEW of the room, so refreshing it is always safe and never loses work.',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          name: { type: 'string', description: 'Sync only the room whose name matches this. Omit when there is one room.' },
          dataRoomId: { type: 'number', description: 'The canonical room id, when you already have it.' },
          objectId: { type: 'string', description: 'Existing dataRoom object to refresh. Omit to reuse the one on the board, or create one.' },
          x: { type: 'number' }, y: { type: 'number' },
        },
      },
      mutates: () => true,
      run: async (raw: unknown) => {
        const blocked = guard();
        if (blocked) return blocked;
        const args = raw as { name?: string; dataRoomId?: number; objectId?: string; x?: number; y?: number };
        const { rooms, room, object } = await resolveRoom(args);
        if (!rooms.length) {
          return {
            dataRoomFound: false,
            instruction: 'This workspace has no data room yet. Say so plainly and offer to author the diligence checklist the user actually needs — do NOT author a dataRoom card with example documents, because a room that lists invented files is worse than no room.',
          };
        }
        if (!room) {
          return {
            dataRoomFound: false,
            reason: 'no-match',
            rooms: rooms.map((candidate) => ({ id: candidate.id, name: candidate.name })),
            instruction: 'No room in this workspace matches. Ask the user which of the rooms listed here they mean rather than guessing.',
          };
        }

        // Fetched together and merged BEFORE anything is staged, so a slow analytics
        // read never half-populates the card.
        const [shares, analytics] = await Promise.all([
          dataRoomShares(room.id).catch(() => [] as DataRoomShareSummary[]),
          dataRoomAnalytics(room.id).catch(() => null),
        ]);
        const fields = dataRoomFieldsFrom(room, shares, analytics);

        if (object) {
          ctx.updateObject(object.id, fields, `Data room refreshed — ${room.readiness}% ready`);
          return { ok: true, proposed: true, dataRoomFound: true, objectId: object.id, dataRoomId: room.id, readiness: room.readiness, activeShares: shares.filter((share) => share.state === 'active').length };
        }
        const { objectId } = ctx.addObject('dataRoom', fields, {
          ...(args.x != null ? { x: args.x } : {}), ...(args.y != null ? { y: args.y } : {}),
        });
        return { ok: true, proposed: true, dataRoomFound: true, objectId, dataRoomId: room.id, readiness: room.readiness, activeShares: 0 };
      },
    },
    {
      name: 'canvas_share_data_room',
      description:
        'Give one named firm access to the data room. This mints a revocable link, sends the NDA first when the room requires one (the link stays closed until it is signed), applies the room\'s expiry, and logs every open and every document read. A watermarked room never issues a download link — say so if the user asked for one. Real names and real addresses only: this sends diligence material to somebody outside the workspace, so never invent a recipient. The link is returned ONCE and cannot be read back — give it to the user in your reply.',
      parameters: {
        type: 'object', required: ['recipientName', 'recipientEmail'], additionalProperties: false,
        properties: {
          objectId: { type: 'string', description: 'The dataRoom card this is about.' },
          dataRoomId: { type: 'number', description: 'The canonical room id, when you already have it.' },
          recipientName: { type: 'string', description: 'The firm or person being given access, by name.' },
          recipientEmail: { type: 'string', description: 'Their real address. Ask the user rather than inventing one.' },
          firmPartyRef: { type: 'string', description: 'The firm\'s partyRef when it is already a counterparty in the workspace, so a view joins to the same investor object the raise pipeline uses.' },
          permission: { type: 'string', enum: ['view', 'download'], description: 'Defaults to view. A watermarked room refuses download.' },
          expiresAt: { type: 'string', description: 'ISO instant the link lapses. The room\'s own expiry applies on top of it.' },
          purpose: { type: 'string', description: 'What the material may be used for, e.g. "evaluating a Series A investment". Narrow is better than broad — it is the NDA\'s scope.' },
          jurisdiction: { type: 'string', description: 'Governing law for the NDA.' },
        },
      },
      mutates: () => true,
      run: async (raw: unknown) => {
        const blocked = guard();
        if (blocked) return blocked;
        const args = raw as {
          objectId?: string; dataRoomId?: number; recipientName?: string; recipientEmail?: string;
          firmPartyRef?: string; permission?: 'view' | 'download'; expiresAt?: string; purpose?: string; jurisdiction?: string;
        };
        if (!args.recipientName?.trim() || !args.recipientEmail?.includes('@')) {
          return { error: 'A data-room share needs a named recipient and a real address — ask the user for the firm and the contact rather than inventing either. This is who the NDA and the access log are about.' };
        }
        const { room, object } = await resolveRoom(args);
        if (!room) return { error: 'No data room in this workspace matches. Call canvas_sync_data_room first.' };

        // The SAME gate `canvas_invoke_object_action` evaluates for every other
        // kind's gated act, checked here because this tool bypasses that seam —
        // see the module header for why it has to.
        const gate = evaluateGate({
          kind: 'dataRoom',
          action: 'share',
          ...(object && typeof object.data.approvalMode === 'string' ? { mode: object.data.approvalMode as ApprovalMode } : {}),
          actor: { kind: 'brain', ref: 'brain', name: 'Brain' },
          provenance: readProvenance(object?.data ?? {}),
        });
        if (!gate.allowed) return { error: gate.message, objectId: object?.id ?? null, awaitingApproval: true };

        const result = await shareDataRoom(room.id, {
          recipientName: args.recipientName,
          recipientEmail: args.recipientEmail,
          firmPartyRef: args.firmPartyRef ?? null,
          ...(args.permission ? { permission: args.permission } : {}),
          expiresAt: args.expiresAt ?? null,
          purpose: args.purpose ?? null,
          jurisdiction: args.jurisdiction ?? null,
        });

        // Redrawn from the room itself rather than patched, so the card cannot
        // claim a share the record does not have.
        const [shares, analytics] = await Promise.all([
          dataRoomShares(room.id).catch(() => [] as DataRoomShareSummary[]),
          dataRoomAnalytics(room.id).catch(() => null),
        ]);
        if (object) {
          ctx.updateObject(object.id, {
            ...dataRoomFieldsFrom(room, shares, analytics),
            ndaState: result.ndaState,
            ...(result.ndaSignatureRequestId ? { ndaSignatureRequestId: result.ndaSignatureRequestId } : {}),
            recipientName: args.recipientName,
            recipientEmail: args.recipientEmail,
          }, `Shared with ${args.recipientName}`);
        }

        return {
          ok: true, proposed: true,
          shareId: result.shareId,
          link: `/data-rooms/shared/${result.token}`,
          permission: result.permission,
          ndaState: result.ndaState,
          expiresAt: result.expiresAt,
          downloadRefusedByWatermark: result.downloadRefusedByWatermark,
          boardUpdated: Boolean(object),
          approval: gate.reason,
          instruction: result.ndaState === 'pending'
            ? 'Give the user the link and tell them the recipient must sign the NDA that was just emailed before it opens. The link cannot be read back later — it exists only in this result.'
            : 'Give the user the link. It cannot be read back later — it exists only in this result.',
        };
      },
    },
    {
      name: 'canvas_file_document_in_data_room',
      description:
        'Put an encrypted legal file — a formation certificate, an executed IP assignment, a signed contract — INTO a data room, so a firm holding a room link can read it alongside the diligence checklist. Pass the `documentId` from the `legalDocument` card (canvas_legal_document_sync puts it there). Pass no dataRoomId to take it back OUT, which stops it resolving through every link into that room immediately. This does not copy the file: the same sealed artifact is simply readable through the room.',
      parameters: {
        type: 'object', required: ['documentId'], additionalProperties: false,
        properties: {
          documentId: { type: 'string', description: 'The documentId on the legalDocument card (a uuid).' },
          dataRoomId: { type: 'number', description: 'The room to file it in. Omit to remove it from every room.' },
          name: { type: 'string', description: 'Name the room instead of passing its id, when there is more than one.' },
          objectId: { type: 'string', description: 'The dataRoom card to refresh afterwards.' },
        },
      },
      mutates: () => true,
      run: async (raw: unknown) => {
        const blocked = guard();
        if (blocked) return blocked;
        const args = raw as { documentId?: string; dataRoomId?: number; name?: string; objectId?: string };
        if (!args.documentId?.trim()) return { error: 'Pass the documentId from the legal document card. Call canvas_legal_document_sync first if the card has none.' };

        const removing = args.dataRoomId == null && !args.name;
        const { room, object } = removing ? { room: null, object: null } : await resolveRoom(args);
        if (!removing && !room) return { error: 'No data room in this workspace matches. Call canvas_sync_data_room first.' };

        await setLegalDocumentDataRoom(args.documentId.trim(), room ? room.id : null);

        if (room && object) {
          const [shares, analytics] = await Promise.all([
            dataRoomShares(room.id).catch(() => [] as DataRoomShareSummary[]),
            dataRoomAnalytics(room.id).catch(() => null),
          ]);
          // Redrawn from the room, so the card cannot claim a document the record
          // does not have — the same direction every projection here runs in.
          const refreshed = (await listDataRooms()).find((candidate) => candidate.id === room.id) ?? room;
          ctx.updateObject(object.id, dataRoomFieldsFrom(refreshed, shares, analytics), 'Document filed in the room');
        }

        return {
          ok: true, proposed: true,
          dataRoomId: room?.id ?? null, boardUpdated: Boolean(room && object),
          instruction: removing
            ? 'The file is out of every data room and stops opening through room links immediately. Say so plainly.'
            : 'The file is readable through this room\'s links now. Anyone already holding one can open it — say so, because it is a change to what they can see.',
        };
      },
    },
    {
      name: 'canvas_revoke_data_room_share',
      description:
        'Withdraw one firm\'s access to the data room. Immediate: the link stops resolving, and the access already recorded stays in the log. Use the `shareId` from the card\'s `shares` rows (canvas_sync_data_room puts it there).',
      parameters: {
        type: 'object', required: ['shareId'], additionalProperties: false,
        properties: {
          shareId: { type: 'string', description: 'The share to revoke, from the card\'s shares rows.' },
          objectId: { type: 'string', description: 'The dataRoom card to refresh afterwards.' },
          dataRoomId: { type: 'number' },
        },
      },
      mutates: () => true,
      run: async (raw: unknown) => {
        const blocked = guard();
        if (blocked) return blocked;
        const args = raw as { shareId?: string; objectId?: string; dataRoomId?: number };
        if (!args.shareId?.trim()) return { error: 'Pass the shareId from the card\'s shares rows. Call canvas_sync_data_room first if the card has none.' };
        await revokeDataRoomShare(args.shareId);

        const { room, object } = await resolveRoom(args);
        if (room && object) {
          const [shares, analytics] = await Promise.all([
            dataRoomShares(room.id).catch(() => [] as DataRoomShareSummary[]),
            dataRoomAnalytics(room.id).catch(() => null),
          ]);
          ctx.updateObject(object.id, dataRoomFieldsFrom(room, shares, analytics), 'Access revoked');
        }
        return {
          ok: true, proposed: true, revoked: args.shareId, boardUpdated: Boolean(room && object),
          instruction: 'The link no longer resolves. Say so plainly, and note that what the recipient already read remains in the room\'s access log.',
        };
      },
    },
  ];
}
