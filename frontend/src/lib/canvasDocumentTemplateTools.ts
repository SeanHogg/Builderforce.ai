/**
 * `canvas_draft_legal_document` — the founders' agreement, on the board (FO-D5).
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────
 * Two founders could find each other — `cofounder_profiles`, the scorer and
 * `/cofounder` all landed together — and had nowhere to record what they agreed.
 * No founders' agreement, no IP assignment, no founder vesting. The register was
 * precise about the shape of the fix: the signature engine already existed and
 * `canvas_request_signature` already routed authored TEXT through it, so what was
 * missing was a TEMPLATE plus a `contract` routed through it.
 *
 * That is exactly this tool. It renders one entry from the ONE template registry
 * (`api/application/legal/documentTemplates.ts` — which the data room's NDA reads
 * from too) and writes the result onto a `contract` card as `documentBody`.
 *
 * ── WHY DRAFTING AND SIGNING ARE TWO STEPS ───────────────────────────────────
 * Every other write in this family is deliberately one call, because the failure
 * it removes is a second write somebody forgets. This one is not, and the reason
 * is the opposite of an oversight: a founders' agreement is the document a company
 * argues about BEFORE it signs it. `contract.sign` is an approval-gated act
 * precisely so a human reads the text first, and rendering-and-sending in one call
 * would route around the gate the kind already declares. So this drafts, and the
 * existing `canvas_request_signature` sends — which is also why there is no second
 * signature path here to keep in step with the first.
 *
 * ── WHY THE VARIABLES ARE NOT ENUMERATED IN THE SCHEMA ───────────────────────
 * Each template declares its own, and the API refuses a render that is missing a
 * required one BY NAME. Restating them in this tool's JSON schema would be a second
 * copy of a list that changes whenever a template does — so the tool passes `values`
 * through and surfaces the refusal, and the model's loop is: draft → "it needs the
 * founders and the effective date" → ask the user → draft. Which is the correct
 * conversation to have before filling a formation document with placeholders.
 */

import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import type { CanvasFounderOpsContext } from '@/lib/canvasFounderOpsTools';
import { documentTemplates, renderDocumentTemplate, type DocumentTemplateSummary, type RenderedDocument } from '@/lib/founderOpsApi';

const NO_TENANT = 'This needs a signed-in, saved canvas session: drafting from the workspace\'s document templates reaches a real workspace. Say so in one sentence and keep building what this canvas can hold; never claim it ran.';

/** The `contract` fields a rendered template writes. `documentBody` is the field
 *  `canvas_request_signature` sends verbatim, so what a signer is shown is what
 *  the card holds — not a summary of it. */
export function contractFieldsFrom(document: RenderedDocument, effectiveDate: string): Record<string, unknown> {
  const counterparty = document.parties.map((party) => party.name).filter(Boolean).join(', ');
  return {
    title: document.title,
    status: 'draft',
    contractType: document.contractType,
    ...(counterparty ? { counterparty } : {}),
    ...(effectiveDate ? { effectiveAt: effectiveDate } : {}),
    templateKey: document.key,
    documentBody: document.body,
    signatureState: 'unsent',
    summary:
      `Drafted from the ${document.title} template and NOT yet sent. `
      + `${document.parties.length} part${document.parties.length === 1 ? 'y' : 'ies'} named. `
      + 'Read it, change what you disagree with, then send it with canvas_request_signature — the text in documentBody is exactly what each signer will be shown and what the signature record freezes.',
  };
}

export function canvasDocumentTemplateActions(ctx: CanvasFounderOpsContext): BrainAction[] {
  const guard = (): { error: string } | null => {
    if (!ctx.hasTenant) return { error: NO_TENANT };
    if (!ctx.canEdit) return { error: 'The current session role cannot edit this canvas' };
    return null;
  };

  const catalogue = (templates: DocumentTemplateSummary[]) => templates.map((template) => ({
    key: template.key,
    title: template.title,
    purpose: template.purpose,
    needs: template.variables.filter((variable) => variable.required).map((variable) => ({ name: variable.name, label: variable.label, hint: variable.hint })),
    optional: template.variables.filter((variable) => !variable.required).map((variable) => ({ name: variable.name, label: variable.label, hint: variable.hint })),
  }));

  return [
    {
      name: 'canvas_draft_legal_document',
      description:
        'Draft a real legal document onto the canvas as a `contract` card — a founders\' agreement, a founder IP assignment, a founder vesting schedule or a mutual NDA. This is the paperwork that comes BEFORE every other document a company produces, and it is what to use whenever the user asks to write down what they and a co-founder agreed, split equity, assign IP, or set vesting. Call it with no `templateKey` to see what exists and what each one needs. It DRAFTS only — read it back to the user and send it with canvas_request_signature once they are happy, never both in one turn. Never invent a founder, an email, an equity percentage or a date: the tool refuses a missing required detail by name, and asking the user is the correct next move.',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          templateKey: { type: 'string', description: 'Which document. Omit to list what exists and what each needs.' },
          values: {
            type: 'object',
            additionalProperties: true,
            description: 'The template\'s own variables. `parties` is an array of {name, email, role, share, contribution} — real people, real addresses, share as a percentage number. Everything else is a plain string or number named by the template.',
          },
          objectId: { type: 'string', description: 'Existing contract object to redraft. Omit to create one.' },
          x: { type: 'number' }, y: { type: 'number' },
        },
      },
      mutates: (raw: unknown) => Boolean((raw as { templateKey?: unknown })?.templateKey),
      run: async (raw: unknown) => {
        const blocked = guard();
        if (blocked) return blocked;
        const args = raw as { templateKey?: string; values?: Record<string, unknown>; objectId?: string; x?: number; y?: number };

        const templates = await documentTemplates();
        if (!args.templateKey) {
          return {
            templates: catalogue(templates),
            instruction: 'Tell the user which of these fits what they are trying to record, then collect the `needs` for it IN THEIR OWN WORDS before calling again. A founders\' agreement with an invented equity split is worse than no document.',
          };
        }
        const template = templates.find((candidate) => candidate.key === args.templateKey);
        if (!template) {
          return {
            error: `No document template named "${args.templateKey}".`,
            templates: catalogue(templates),
          };
        }

        let document: RenderedDocument;
        try {
          document = await renderDocumentTemplate(template.key, args.values ?? {});
        } catch (error) {
          // The API names the missing variables. Surfaced verbatim WITH the hints,
          // so the model asks for the right thing rather than filling a formation
          // document with a placeholder.
          return {
            error: error instanceof Error ? error.message : 'The document could not be drafted.',
            needs: template.variables.filter((variable) => variable.required).map((variable) => ({ name: variable.name, label: variable.label, hint: variable.hint })),
            instruction: 'Ask the user for the missing detail in one short question. Never fill a formation document with a placeholder.',
          };
        }

        const effectiveDate = typeof args.values?.effectiveDate === 'string' ? args.values.effectiveDate : '';
        const fields = contractFieldsFrom(document, effectiveDate);
        const target = args.objectId ? ctx.objects().find((object) => object.id === args.objectId) : null;
        if (target) {
          ctx.updateObject(target.id, fields, `Redrafted ${document.title}`);
          return {
            ok: true, proposed: true, objectId: target.id, templateKey: document.key,
            parties: document.parties.map((party) => ({ name: party.name, email: party.email })),
            instruction: 'Summarise what the draft actually says — the holdings, the vesting, and anything the document itself flagged — then ask the user to confirm before you send it with canvas_request_signature.',
          };
        }
        const { objectId } = ctx.addObject('contract', fields, {
          ...(args.x != null ? { x: args.x } : {}), ...(args.y != null ? { y: args.y } : {}),
        });
        return {
          ok: true, proposed: true, objectId, templateKey: document.key,
          parties: document.parties.map((party) => ({ name: party.name, email: party.email })),
          instruction: 'Summarise what the draft actually says — the holdings, the vesting, and anything the document itself flagged — then ask the user to confirm before you send it with canvas_request_signature.',
        };
      },
    },
  ];
}
