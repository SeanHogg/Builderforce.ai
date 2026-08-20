/**
 * `canvas_request_signature` — THE generic e-signature request, for any object kind
 * that carries `signatureState`/`signatureRequestId` bookkeeping fields.
 *
 * ── THE GAP THIS CLOSES ────────────────────────────────────────────────────────
 * `founderObjects.ts` declares `contract.signatureState`/`signatureRequestId`/
 * `signedAt` as bookkeeping fields — "written by the sign flow, never asserted" —
 * and `hiringObjects.ts` declares the identical trio on `offer`. Neither flow
 * existed: nothing in `CreationCanvas.tsx` or `canvasFounderOpsTools.ts` ever called
 * `createSignatureRequest` for either kind, so `contract`'s `sign` action and
 * `offer`'s `send`/`sign` actions were declared, advertised to the model as
 * "connected" (`CONNECTED_CANVAS_ACTIONS`), and did nothing real.
 *
 * ── WHY GENERIC RATHER THAN A SECOND `contract`-SHAPED TOOL ─────────────────────
 * A `legalDocument`'s signature request is FILE-backed — it freezes an uploaded
 * artifact's checksum — and stays in `canvasLegalDocumentTools.ts`, which is the
 * right home for it (see that module's header). `contract` and `offer` are the
 * opposite shape: authored TEXT with no uploaded file, exactly what the existing
 * generic `createSignatureRequest` client (`founderOpsApi.ts`) already sends as
 * `documentBody`. Building a second parallel implementation for two kinds whose
 * only difference from each other is which fields their summary comes from would be
 * the duplication the "no technical debt" rule forbids — so ONE tool serves every
 * kind that declares the bookkeeping pair, discovered from the spec registry rather
 * than hard-coded, so a third kind that adds the same two fields is covered the
 * moment it is declared.
 *
 * ── THE APPROVAL GATE, AND WHY IT IS PER-KIND ────────────────────────────────────
 * `contract.sign` is gated in `canvasApprovalGate.GATED_ACTIONS`; `offer.sign` is
 * deliberately NOT — the founder-ops comment for it explains why: `offer.sign` only
 * re-reads a request `offer.send` already created, so gating it would ask a human to
 * approve a status refresh. The act THIS tool performs — creating a brand-new
 * signature request — is what `offer.send` names, not what `offer.sign` names. So
 * the gate check below is evaluated against the action name each kind actually
 * gates its request-CREATING act under, not against the literal string "sign".
 */

import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import { SIGNATURE_INTENTS } from '@builderforce/creation-canvas-contract';
import { evaluateGate, readProvenance, type ApprovalMode } from '@/lib/canvasApprovalGate';
import type { CanvasFounderOpsContext } from '@/lib/canvasFounderOpsTools';
import { createSignatureRequest, signatureProgress } from '@/lib/founderOpsApi';
import { signatureFieldsFrom, signatureSummary } from '@/lib/canvasSignatureProjection';
import { allSpecObjectSpecs } from '@/lib/specObjects';
// Registers every spec vocabulary as an import side effect, so `allSpecObjectSpecs()`
// answers correctly even when this module is the first thing to import the spec
// machinery (a unit test, a surface that never touches `creationObjectRegistry`).
// See `specObjectSets.ts`'s own header for why an accidental import order is not a
// dependency.
import '@/lib/specObjectSets';

const NO_TENANT = 'This needs a signed-in, saved canvas session: it reads and writes a real workspace record, and an anonymous board has no workspace behind it. Say so in one sentence and keep building what this canvas can hold; never claim it ran.';

/** The kind-specific act that CREATES the signature request, for the gate check —
 *  see the module header for why `offer` maps to `send` rather than `sign`. Falls
 *  back to `sign`, which is what every kind but `offer` actually calls it. */
const GATE_ACTION_BY_KIND: Readonly<Record<string, string>> = { offer: 'send' };

/** Every kind whose spec declares BOTH `signatureState` and `signatureRequestId` —
 *  today `contract` and `offer`, and any future kind that adds the same pair
 *  without this tool needing to change. Computed once per call rather than cached
 *  at module scope: the registry can still be gaining sets while this module loads
 *  in a test. */
function signatureCapableKinds(): ReadonlySet<string> {
  return new Set(
    allSpecObjectSpecs()
      .filter((spec) => spec.fields.some((field) => field.name === 'signatureState')
        && spec.fields.some((field) => field.name === 'signatureRequestId'))
      .map((spec) => spec.kind),
  );
}

/**
 * The text to sign, when the model did not supply one.
 *
 * `documentBody` FIRST, and that order is load-bearing: a `contract` drafted from a
 * real template (`canvas_draft_legal_document`) holds the whole agreement there, and
 * falling through to `summary` would send a signer a one-line description of a
 * founders' agreement instead of the founders' agreement. The summary remains the
 * fallback for a kind that carries no body — an `offer`, or a contract somebody
 * described rather than drafted — because a short honest statement of terms is a
 * real thing to sign, and invented content is not.
 */
function defaultDocumentBody(object: { kind: string; title: string; data: Record<string, unknown> }): string {
  const body = typeof object.data.documentBody === 'string' ? object.data.documentBody.trim() : '';
  if (body) return body;
  const summary = typeof object.data.summary === 'string' ? object.data.summary.trim() : '';
  const lines = [object.title || object.kind, summary].filter(Boolean);
  return lines.join('\n\n') || `${object.kind}: ${object.title}`;
}

export function canvasSignatureActions(ctx: CanvasFounderOpsContext): BrainAction[] {
  const guard = (): { error: string } | null => {
    if (!ctx.hasTenant) return { error: NO_TENANT };
    if (!ctx.canEdit) return { error: 'The current session role cannot edit this canvas' };
    return null;
  };

  return [
    {
      name: 'canvas_request_signature',
      description:
        'Send an authored object\'s content for e-signature — works on any object kind that carries signatureState/signatureRequestId bookkeeping fields (today: `contract`, `offer`). Sends the TEXT of the object (its summary, or documentBody if you pass one) through the signature engine, and writes signatureState/signatureRequestId back onto the card. For an uploaded FILE, use canvas_legal_document_request_signature instead — this tool is for authored objects with no file behind them.',
      parameters: {
        type: 'object', required: ['objectId', 'subject', 'parties'], additionalProperties: false,
        properties: {
          objectId: { type: 'string' },
          subject: { type: 'string', description: 'What the signer sees as the request subject line.' },
          documentBody: { type: 'string', description: 'The text to sign. Omit to use the object\'s own summary.' },
          intent: { type: 'string', enum: [...SIGNATURE_INTENTS] },
          expiresAt: { type: 'string', description: 'ISO instant the request lapses. Omit for the engine\'s default.' },
          remindAfterDays: { type: 'number' },
          parties: {
            type: 'array', minItems: 1,
            items: {
              type: 'object', required: ['name', 'email'], additionalProperties: false,
              properties: { name: { type: 'string' }, email: { type: 'string' }, partyRef: { type: 'string' } },
            },
            description: 'Who must sign. Real names and emails only — never invent one; ask the user for a missing address.',
          },
        },
      },
      mutates: () => true,
      run: async (raw: unknown) => {
        const blocked = guard();
        if (blocked) return blocked;
        const args = raw as {
          objectId?: string; subject?: string; documentBody?: string; intent?: string;
          expiresAt?: string; remindAfterDays?: number;
          parties?: Array<{ name: string; email: string; partyRef?: string }>;
        };
        if (!args.objectId) return { error: 'objectId is required' };
        const object = ctx.objects().find((candidate) => candidate.id === args.objectId);
        if (!object) return { error: 'No object with that id on this board.' };

        const capable = signatureCapableKinds();
        if (!capable.has(object.kind)) {
          return { error: `${object.kind} does not carry signatureState/signatureRequestId — canvas_request_signature only works on kinds that do (today: ${[...capable].join(', ') || 'none registered'}).` };
        }
        if (!args.subject?.trim()) return { error: 'subject is required' };
        if (!args.parties?.length) return { error: 'At least one signing party (name + email) is required. Ask the user for the counterparty\'s email rather than inventing one.' };

        const gate = evaluateGate({
          kind: object.kind,
          action: GATE_ACTION_BY_KIND[object.kind] ?? 'sign',
          ...(typeof object.data.approvalMode === 'string' ? { mode: object.data.approvalMode as ApprovalMode } : {}),
          actor: { kind: 'brain', ref: 'brain', name: 'Brain' },
          provenance: readProvenance(object.data),
        });
        if (!gate.allowed) return { error: gate.message, objectId: object.id, awaitingApproval: true };

        const result = await createSignatureRequest({
          subject: args.subject,
          ...(args.intent ? { intent: args.intent as (typeof SIGNATURE_INTENTS)[number] } : {}),
          documentTitle: object.title || object.kind,
          documentBody: args.documentBody?.trim() || defaultDocumentBody(object),
          objectId: object.id,
          ...(args.expiresAt ? { expiresAt: args.expiresAt } : {}),
          ...(args.remindAfterDays != null ? { remindAfterDays: args.remindAfterDays } : {}),
          parties: args.parties.map((party) => ({ name: party.name, email: party.email, partyRef: party.partyRef ?? null })),
        });

        ctx.updateObject(object.id, { signatureState: 'sent', signatureRequestId: result.requestId }, `Signature requested — ${args.subject}`);

        return {
          ok: true, proposed: true, objectId: object.id,
          requestId: result.requestId, invitations: result.invitations, approval: gate.reason,
          instruction: 'Tell the user the signature request was sent, and to whom. Call canvas_sync_signature later to see who has actually answered — nothing on the card updates until you do.',
        };
      },
    },
    {
      name: 'canvas_sync_signature',
      description:
        'Read a signature or acknowledgement request back onto the card that sent it — who has signed, who has declined, who has not answered, and when it completed. Call this whenever the user asks about the status of a contract, an offer or a policy acknowledgement ("has everyone signed the handbook", "did they sign yet"), and after any wait. For a `policy` it also rewrites the roster and the acknowledgement rate, which is the only way those two fields are ever written. Reads only — it never asks anybody to sign anything.',
      parameters: {
        type: 'object', required: ['objectId'], additionalProperties: false,
        properties: {
          objectId: { type: 'string', description: 'The card whose signatureRequestId should be re-read.' },
        },
      },
      // A READ. Not gated and not a proposal in the approval sense — but it does
      // write the card, so it stages a change like every other authoring tool.
      mutates: () => true,
      run: async (raw: unknown) => {
        const blocked = guard();
        if (blocked) return blocked;
        const args = raw as { objectId?: string };
        if (!args.objectId) return { error: 'objectId is required' };
        const object = ctx.objects().find((candidate) => candidate.id === args.objectId);
        if (!object) return { error: 'No object with that id on this board.' };

        const requestId = Number(object.data.signatureRequestId);
        if (!Number.isInteger(requestId) || requestId <= 0) {
          return {
            error: `${object.title || object.kind} has no signature request behind it yet. Send one with canvas_request_signature first — do not report a status for a document nobody has been asked to sign.`,
          };
        }

        const progress = await signatureProgress(requestId);
        const fields = signatureFieldsFrom(object.kind, progress);
        ctx.updateObject(object.id, { ...fields, summary: signatureSummary(progress) }, `Signature status — ${progress.agreed}/${progress.total}`);

        return {
          ok: true, proposed: true, objectId: object.id,
          status: progress.status, agreed: progress.agreed, total: progress.total, settled: progress.settled,
          outstanding: progress.parties.filter((party) => party.status !== 'signed' && party.status !== 'acknowledged' && party.status !== 'declined')
            .map((party) => ({ name: party.name, email: party.email })),
          declined: progress.parties.filter((party) => party.status === 'declined').map((party) => ({ name: party.name, email: party.email })),
          instruction: 'Report who is OUTSTANDING by name — that is the list somebody acts on. Never say a document is signed unless status is "completed".',
        };
      },
    },
  ];
}
