/**
 * The canvas's SELL-MOTION vocabulary — how Brain drives a deal.
 *
 * ── WHY THESE ARE DEDICATED TOOLS AND NOT `canvas_invoke_object_action` ─────────
 * The same argument `canvasLegalDocumentTools.ts` makes for its four: a generic,
 * argument-less action dispatch cannot carry a recipient, an expiry, a discount or a
 * trial length, and every act here needs at least one of those. So each is a named tool
 * with typed arguments, and the sell-motion kinds are absent from
 * `CONNECTED_CANVAS_ACTIONS`.
 *
 * ── THE APPROVAL GATE, EVALUATED HERE ───────────────────────────────────────────
 * Six of these acts are OUTBOUND — they put a price, a board, a security posture or an
 * automated send in front of somebody outside the tenant — and are declared in
 * `canvasApprovalGate.GATED_ACTIONS`. Because they do not route through
 * `canvas_invoke_object_action` (the one place that gate is normally evaluated), each
 * gated tool evaluates it itself, at the same point the dispatcher would have. The
 * asymmetry to notice: STOPPING a sequence is not gated, because a control that needs
 * approval to stop is not a safety control.
 *
 * ── WHAT NO TOOL HERE CAN DO ────────────────────────────────────────────────────
 * Accept a quote. That is not an oversight and not a permission level — the acceptance
 * route is reachable only with the buyer's own token (`prospectActions.ts`), so a seller,
 * an agent and a model are all equally unable to close a deal on the buyer's behalf. The
 * `derived` flags on `acceptedAt`/`acceptedBy` are only as good as that being true.
 */

import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import {
  quoteTotals, readQuoteLines, readSequenceEnrolments,
  type QuoteLine, type SequenceEnrolment,
} from '@builderforce/creation-canvas-contract';
import { evaluateGate, readProvenance, type ApprovalMode } from '@/lib/canvasApprovalGate';
import type { CanvasFounderOpsContext } from '@/lib/canvasFounderOpsTools';
import { fetchPublicPricing } from '@/lib/publicPricing';
import {
  assembleTrustPacketCard, handoffPlanCard, listProspectShares, mintProspectShare,
  provisionTrialCard, readCallCard, readProspectEngagement, revokeProspectShare,
} from '@/lib/prospectShareApi';

const NO_TENANT = 'This needs a signed-in, saved canvas session: it reaches a real workspace record, and an anonymous board has no workspace behind it. Say so in one sentence and keep building what this canvas can hold; never claim it ran.';

type BoardObject = { id: string; kind: string; title: string; data: Record<string, unknown> };

const text = (value: unknown, max = 200): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

/** Resolve one card of an expected kind, or the tool error to return. ONE resolver, so
 *  ten tools cannot disagree about what "no such card" reads like. */
function findCard(
  ctx: CanvasFounderOpsContext,
  objectId: string | undefined,
  kind: string,
): { object: BoardObject } | { error: string } {
  if (!objectId) return { error: 'objectId is required' };
  const object = ctx.objects().find((candidate) => candidate.id === objectId);
  if (!object) return { error: 'No object with that id on this board.' };
  if (object.kind !== kind) return { error: `That card is a ${object.kind}, not a ${kind}.` };
  return { object };
}

/** The one place a gated sell-motion act checks the gate, matching where
 *  `canvas_invoke_object_action` checks it for every other kind. */
function gateOrError(object: BoardObject, action: string): { error: string } | null {
  const gate = evaluateGate({
    kind: object.kind,
    action,
    ...(typeof object.data.approvalMode === 'string' ? { mode: object.data.approvalMode as ApprovalMode } : {}),
    actor: { kind: 'brain', ref: 'brain', name: 'Brain' },
    provenance: readProvenance(object.data),
  });
  return gate.allowed ? null : { error: gate.message };
}

/** The engagement patch a shared card takes. Written once here and once server-side
 *  (`engagementPatch`), because the two produce the same four fields for two different
 *  callers — the tool below, and any sweep that refreshes without a browser. */
function engagementFields(
  engagement: { opens: number; lastSeenAtISO: string; hotspots: ReadonlyArray<{ objectLabel: string; seconds: number; views: number }> },
  shareUrl: string,
): Record<string, unknown> {
  return {
    ...(shareUrl ? { shareUrl } : {}),
    shareOpens: engagement.opens,
    shareLastSeenAt: engagement.lastSeenAtISO,
    engagementHotspots: engagement.hotspots.map((spot) => ({
      objectLabel: spot.objectLabel, seconds: spot.seconds, views: spot.views,
    })),
  };
}

export function canvasSellMotionActions(ctx: CanvasFounderOpsContext): BrainAction[] {
  const guard = (): { error: string } | null => {
    if (!ctx.hasTenant) return { error: NO_TENANT };
    if (!ctx.canEdit) return { error: 'The current session role cannot edit this canvas' };
    return null;
  };
  const sessionId = () => ctx.sessionId;

  return [
    {
      name: 'canvas_share_with_prospect',
      description:
        'Give a prospect a link to this BOARD, or to ONE commercial card on it (a quote, a trust packet, a mutual action plan, a call recap, a trial, a prototype, a deck or a site). They need no account. GATED for a card whose kind declares `share`: it puts a priced offer or a security posture outside the workspace. The link is watch-only; set allowControlRequest to let them ASK to drive, which raises a signal you grant live. Returns the plaintext link EXACTLY ONCE — quote it in your reply, because only its hash is stored and it cannot be retrieved again.',
      parameters: {
        type: 'object', required: [], additionalProperties: false,
        properties: {
          objectId: { type: 'string', description: 'A card to share. Omit to share the whole board.' },
          label: { type: 'string', description: 'What to call this link in the seller\'s own list — "the quote I sent Acme". Never shown to the prospect.' },
          sellerName: { type: 'string', description: 'The person the prospect sees this from.' },
          sellerCompany: { type: 'string', description: 'The company the prospect sees this from. NOT Builderforce — a demo that reads as our brand to a buyer is a demo of the wrong product.' },
          message: { type: 'string', description: 'One or two lines the buyer reads above the artifact. The seller\'s framing.' },
          accentColor: { type: 'string', description: 'Hex colour for the buyer page, from the seller\'s brand. Omit for the platform default.' },
          allowControlRequest: { type: 'boolean', description: 'Let them ask to drive. Default false — watch-only.' },
          expiresAt: { type: 'string', description: 'ISO instant the link stops working. Defaults to 30 days, which is one buying cycle.' },
        },
      },
      mutates: () => true,
      run: async (raw: unknown) => {
        const blocked = guard();
        if (blocked) return blocked;
        const args = raw as Record<string, unknown>;
        const objectId = text(args.objectId, 64);

        let object: BoardObject | null = null;
        if (objectId) {
          const found = ctx.objects().find((candidate) => candidate.id === objectId);
          if (!found) return { error: 'No object with that id on this board.' };
          object = found;
          const gated = gateOrError(found, 'share');
          if (gated) return gated;
        }

        const share = await mintProspectShare(sessionId(), {
          objectId: objectId || null,
          label: text(args.label, 160) || object?.title || '',
          sellerName: text(args.sellerName, 120),
          sellerCompany: text(args.sellerCompany, 160),
          accentColor: text(args.accentColor, 32),
          message: text(args.message, 600),
          allowControlRequest: args.allowControlRequest === true,
          expiresAt: text(args.expiresAt, 40) || null,
        });

        const url = typeof window !== 'undefined'
          ? `${window.location.origin}${share.viewPath}`
          : share.viewPath;
        if (object) ctx.updateObject(object.id, { shareUrl: url }, 'Shared with a prospect');

        return {
          ok: true, proposed: !!object, shareId: share.id, shareUrl: url, expiresAt: share.expiresAt,
          instruction: `Tell the user this link now — it will not be shown again: ${url}`,
        };
      },
    },

    {
      name: 'canvas_list_prospect_shares',
      description: 'List the live prospect links on this board — what each one points at, when it expires, how many times it has been opened and when it was last seen. Call this before revoking one, and before answering "who has a link to this".',
      parameters: { type: 'object', required: [], additionalProperties: false, properties: {} },
      run: async () => {
        const blocked = guard();
        if (blocked) return blocked;
        return { ok: true, shares: await listProspectShares(sessionId()) };
      },
    },

    {
      name: 'canvas_revoke_prospect_share',
      description: 'Revoke one prospect link immediately. Not gated: revoking only ever reduces external access. Get the shareId from canvas_list_prospect_shares.',
      parameters: {
        type: 'object', required: ['shareId'], additionalProperties: false,
        properties: { shareId: { type: 'string' } },
      },
      mutates: () => true,
      run: async (raw: unknown) => {
        const blocked = guard();
        if (blocked) return blocked;
        const shareId = text((raw as Record<string, unknown>).shareId, 64);
        if (!shareId) return { error: 'shareId is required' };
        await revokeProspectShare(sessionId(), shareId);
        return { ok: true, revoked: shareId };
      },
    },

    {
      name: 'canvas_refresh_prospect_engagement',
      description:
        'Read what the prospect actually DID with a shared card — how many times they opened it, when they were last there, and which parts they spent time on — and write it onto the card. This is the ONLY writer for shareOpens, shareLastSeenAt and engagementHotspots. Call it before answering ANY question about whether a prospect has looked at something; the card can be stale, and "they spent four minutes on the security card" is a different follow-up from "they spent four minutes on pricing".',
      parameters: {
        type: 'object', required: [], additionalProperties: false,
        properties: { objectId: { type: 'string', description: 'A shared card. Omit for the board-level share.' } },
      },
      mutates: () => true,
      run: async (raw: unknown) => {
        const blocked = guard();
        if (blocked) return blocked;
        const objectId = text((raw as Record<string, unknown>).objectId, 64);
        const result = await readProspectEngagement(sessionId(), objectId || undefined);
        const engagement = result.engagement;
        if (objectId) {
          const object = ctx.objects().find((candidate) => candidate.id === objectId);
          if (!object) return { error: 'No object with that id on this board.' };
          ctx.updateObject(objectId, engagementFields(engagement, text(object.data.shareUrl, 400)), 'Refreshed prospect engagement');
        }
        return { ok: true, proposed: !!objectId, engagement };
      },
    },

    {
      name: 'canvas_price_quote',
      description:
        'Seed a quote\'s lines with the CURRENT list prices from the published pricing contract, and recompute its totals. Use this rather than typing unitPriceCents: a price you invent is one the buyer can compare against the public page. It only fills lines that name a plan (pro or teams) and leaves services lines alone. Not gated — it exposes nothing outside the workspace.',
      parameters: {
        type: 'object', required: ['objectId'], additionalProperties: false,
        properties: {
          objectId: { type: 'string' },
          plan: { type: 'string', enum: ['pro', 'teams'], description: 'Add or replace a plan line with this plan.' },
          billingCycle: { type: 'string', enum: ['monthly', 'yearly'] },
          seats: { type: 'number', minimum: 1, maximum: 100000 },
          discountPercent: { type: 'number', minimum: 0, maximum: 100, description: 'The negotiated discount on the plan line. State it here rather than reducing the unit price — a buyer needs to SEE what they were given.' },
          termMonths: { type: 'number', minimum: 1, maximum: 120 },
        },
      },
      mutates: () => true,
      run: async (raw: unknown) => {
        const blocked = guard();
        if (blocked) return blocked;
        const args = raw as Record<string, unknown>;
        const found = findCard(ctx, text(args.objectId, 64), 'quote');
        if ('error' in found) return found;

        const pricing = await fetchPublicPricing();
        if (!pricing) return { error: 'The published pricing could not be read just now. Try again rather than inventing a price.' };

        const cycle = args.billingCycle === 'yearly' ? 'yearly' as const : 'monthly' as const;
        const seats = Math.max(1, Math.round(Number(args.seats ?? pricing.pricing.teams.minimumSeats)));
        const discountPercent = Math.min(100, Math.max(0, Number(args.discountPercent ?? 0)));
        const termMonths = Math.min(120, Math.max(1, Math.round(Number(args.termMonths ?? found.object.data.termMonths ?? 12))));

        // Major units → integer cents at the edge, exactly once. Every downstream figure
        // is cents, which is what keeps a total from being re-derived out of a display
        // string somewhere later.
        const unitPriceCents = (plan: 'pro' | 'teams') => plan === 'teams'
          ? Math.round((cycle === 'yearly' ? pricing.pricing.teams.perSeatYearly : pricing.pricing.teams.perSeatMonthly) * 100)
          : Math.round((cycle === 'yearly' ? pricing.pricing.pro.yearly : pricing.pricing.pro.monthly) * 100);

        const existing = readQuoteLines(found.object.data.lines);
        const plan = args.plan === 'teams' ? 'teams' as const : args.plan === 'pro' ? 'pro' as const : null;

        let lines: QuoteLine[];
        if (plan) {
          const planLine: QuoteLine = {
            description: plan === 'teams' ? 'Teams plan' : 'Pro plan',
            plan,
            billingCycle: cycle,
            seats: plan === 'teams' ? Math.max(pricing.pricing.teams.minimumSeats, seats) : 1,
            unitPriceCents: unitPriceCents(plan),
            discountPercent,
          };
          lines = [planLine, ...existing.filter((line) => !line.plan)];
        } else {
          // No plan named: RE-PRICE the plan lines already there, leave the rest.
          lines = existing.map((line) => (line.plan === 'pro' || line.plan === 'teams')
            ? { ...line, billingCycle: cycle, unitPriceCents: unitPriceCents(line.plan as 'pro' | 'teams'), ...(args.discountPercent === undefined ? {} : { discountPercent }) }
            : line);
        }

        const totals = quoteTotals(lines, termMonths);
        ctx.updateObject(found.object.id, {
          lines, termMonths, currency: pricing.currency || 'USD',
        }, 'Priced the quote');
        return { ok: true, proposed: true, objectId: found.object.id, lines, termMonths, totals };
      },
    },

    {
      name: 'canvas_read_call',
      description:
        'Read a call card\'s TRANSCRIPT and write back the objections the buyer raised, what they actually committed to, the next step, the tone, and our share of the talking. The transcript itself is read-only — you can never author one, because a transcript you wrote is a fabricated quotation attributed to a named person. Call this before coaching on a deal: "activity was high and every call died on price" is an answer no activity count can give.',
      parameters: {
        type: 'object', required: ['objectId'], additionalProperties: false,
        properties: { objectId: { type: 'string' } },
      },
      mutates: () => true,
      run: async (raw: unknown) => {
        const blocked = guard();
        if (blocked) return blocked;
        const found = findCard(ctx, text((raw as Record<string, unknown>).objectId, 64), 'call');
        if ('error' in found) return found;
        const result = await readCallCard(sessionId(), found.object.id);
        ctx.updateObject(found.object.id, result.card, 'Read the call');
        return { ok: true, proposed: true, objectId: found.object.id, ...result.card };
      },
    },

    {
      name: 'canvas_assemble_trust_packet',
      description:
        'Pull this workspace\'s REAL security evidence into a trust packet: the control register as it actually stands, the subprocessors this workspace has actually connected, the DPA and policy links, and answers to whichever questionnaire rows the evidence can honestly answer. It never overwrites a row a person wrote and never invents an answer — rows it cannot support stay unanswered, which is the state the readiness meter is supposed to show. Not gated: nothing leaves the workspace until the packet is shared.',
      parameters: {
        type: 'object', required: ['objectId'], additionalProperties: false,
        properties: { objectId: { type: 'string' } },
      },
      mutates: () => true,
      run: async (raw: unknown) => {
        const blocked = guard();
        if (blocked) return blocked;
        const found = findCard(ctx, text((raw as Record<string, unknown>).objectId, 64), 'trustPacket');
        if ('error' in found) return found;
        const result = await assembleTrustPacketCard(sessionId(), found.object.id);
        ctx.updateObject(found.object.id, result.card, 'Assembled the trust packet');
        return { ok: true, proposed: true, objectId: found.object.id, answered: result.answered };
      },
    },

    {
      name: 'canvas_provision_trial',
      description:
        'Turn the board you just built with the prospect into a time-boxed trial board of its own. GATED: it creates a real workspace artifact for somebody outside the tenant. After it returns, call canvas_share_with_prospect on the trial card so they can actually open it — provisioning alone gives them nothing.',
      parameters: {
        type: 'object', required: ['objectId'], additionalProperties: false,
        properties: {
          objectId: { type: 'string' },
          days: { type: 'number', minimum: 1, maximum: 180, description: 'How long the trial runs. Default 14.' },
          sourceSessionId: { type: 'string', description: 'The board to copy. Defaults to THIS board, which is almost always what is meant.' },
        },
      },
      mutates: () => true,
      run: async (raw: unknown) => {
        const blocked = guard();
        if (blocked) return blocked;
        const args = raw as Record<string, unknown>;
        const found = findCard(ctx, text(args.objectId, 64), 'trial');
        if ('error' in found) return found;
        const gated = gateOrError(found.object, 'provision');
        if (gated) return gated;
        const result = await provisionTrialCard(sessionId(), found.object.id, {
          ...(args.days === undefined ? {} : { days: Number(args.days) }),
          ...(text(args.sourceSessionId, 64) ? { sourceSessionId: text(args.sourceSessionId, 64) } : {}),
        });
        ctx.updateObject(found.object.id, result.card, 'Provisioned the trial');
        return {
          ok: true, proposed: true, objectId: found.object.id, sessionId: result.sessionId,
          instruction: 'Now call canvas_share_with_prospect on this trial card so the prospect can open it.',
        };
      },
    },

    {
      name: 'canvas_handoff_plan',
      description:
        'On close, copy the board built during the sale into a fresh board for the customer to go live from — objects and connections, without the seller\'s conversation, engagement history or live links. GATED: it creates real state for the customer. This is what stops the thing you built together being stranded on the seller\'s canvas.',
      parameters: {
        type: 'object', required: ['objectId'], additionalProperties: false,
        properties: {
          objectId: { type: 'string', description: 'The mutualActionPlan card.' },
          sourceSessionId: { type: 'string', description: 'The board to hand over. Defaults to THIS board.' },
        },
      },
      mutates: () => true,
      run: async (raw: unknown) => {
        const blocked = guard();
        if (blocked) return blocked;
        const args = raw as Record<string, unknown>;
        const found = findCard(ctx, text(args.objectId, 64), 'mutualActionPlan');
        if ('error' in found) return found;
        const gated = gateOrError(found.object, 'handoff');
        if (gated) return gated;
        const result = await handoffPlanCard(sessionId(), found.object.id, {
          ...(text(args.sourceSessionId, 64) ? { sourceSessionId: text(args.sourceSessionId, 64) } : {}),
        });
        ctx.updateObject(found.object.id, result.card, 'Handed the board off');
        return { ok: true, proposed: true, objectId: found.object.id, sessionId: result.sessionId };
      },
    },

    {
      name: 'canvas_enrol_in_sequence',
      description:
        'Add people to a cadence. GATED: enrolment is what makes real messages go to real people. Each person is enrolled from NOW, so their day-0 step fires on the next runner tick and their day-2 step two days after that. Somebody already enrolled is left exactly where they are — re-enrolling would restart their cadence and send them a first-touch email they have already had.',
      parameters: {
        type: 'object', required: ['objectId', 'people'], additionalProperties: false,
        properties: {
          objectId: { type: 'string' },
          people: {
            type: 'array', maxItems: 200,
            items: {
              type: 'object', required: ['contactRef'], additionalProperties: false,
              properties: {
                contactRef: { type: 'string', description: 'An email for email/sms steps, a handle for social. Never invent one.' },
                name: { type: 'string' },
              },
            },
          },
        },
      },
      mutates: () => true,
      run: async (raw: unknown) => {
        const blocked = guard();
        if (blocked) return blocked;
        const args = raw as Record<string, unknown>;
        const found = findCard(ctx, text(args.objectId, 64), 'sequence');
        if ('error' in found) return found;
        const gated = gateOrError(found.object, 'enrol');
        if (gated) return gated;

        const existing = readSequenceEnrolments(found.object.data.enrolments);
        const known = new Set(existing.map((row) => row.contactRef.toLowerCase()));
        const nowISO = new Date().toISOString();
        const added: SequenceEnrolment[] = [];
        for (const entry of Array.isArray(args.people) ? args.people.slice(0, 200) : []) {
          const row = entry as Record<string, unknown>;
          const contactRef = text(row.contactRef, 320);
          if (!contactRef || known.has(contactRef.toLowerCase())) continue;
          known.add(contactRef.toLowerCase());
          added.push({
            contactRef, name: text(row.name, 200), enrolledAtISO: nowISO,
            stepsSent: 0, lastSentAtISO: '', repliedAtISO: '', stoppedAtISO: '',
          });
        }
        if (added.length === 0) return { error: 'Nobody new to enrol — every contact given is already in this cadence.' };

        ctx.updateObject(found.object.id, { enrolments: [...existing, ...added] }, `Enrolled ${added.length} in the cadence`);
        return { ok: true, proposed: true, objectId: found.object.id, enrolled: added.length, total: existing.length + added.length };
      },
    },

    {
      name: 'canvas_set_sequence_state',
      description:
        'Start, pause or stop a cadence. Only a RUNNING cadence sends anything; pausing keeps every person\'s place so resuming does not re-send their first touch. Starting is GATED — it begins automated sends to real people. Pausing and stopping are not: a control that needs approval to stop is not a safety control.',
      parameters: {
        type: 'object', required: ['objectId', 'state'], additionalProperties: false,
        properties: {
          objectId: { type: 'string' },
          state: { type: 'string', enum: ['running', 'paused', 'stopped'] },
        },
      },
      mutates: () => true,
      run: async (raw: unknown) => {
        const blocked = guard();
        if (blocked) return blocked;
        const args = raw as Record<string, unknown>;
        const found = findCard(ctx, text(args.objectId, 64), 'sequence');
        if ('error' in found) return found;
        const state = text(args.state, 16);
        if (!['running', 'paused', 'stopped'].includes(state)) return { error: 'state must be running, paused or stopped.' };
        if (state === 'running') {
          const gated = gateOrError(found.object, 'start');
          if (gated) return gated;
          const steps = Array.isArray(found.object.data.steps) ? found.object.data.steps.length : 0;
          if (steps === 0) return { error: 'This cadence has no steps. A running sequence with nothing to send would go quiet and look like it worked.' };
        }
        const label = state === 'running' ? 'Started the cadence' : state === 'paused' ? 'Paused the cadence' : 'Stopped the cadence';
        ctx.updateObject(found.object.id, {
          sequenceState: state,
          status: state === 'running' ? 'Running' : state === 'paused' ? 'Paused' : 'Stopped',
        }, label);
        return { ok: true, proposed: true, objectId: found.object.id, sequenceState: state };
      },
    },
  ];
}
