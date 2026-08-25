/**
 * The canvas's REQUISITION vocabulary — one tool, and the join it exists to create.
 *
 * ── WHAT THIS CLOSES (FO-B3) ────────────────────────────────────────────────────
 * `jobPosting.applicantCount` was documented as "read from the hiring domain" and had
 * no reader, because there was nothing to read it BY. A canvas `jobPosting` was board
 * JSON: a title, a comp band and a list of must-haves, with no handle on the
 * `job_postings` row a real `job_applications` count joins to. The only join available
 * was `job_postings.title = card.title`, which is precisely the string matching
 * `canvas_sync_account` was built to remove from the commercial half of the board —
 * and it fails worse here, because two requisitions for "Senior React Engineer" in one
 * quarter is normal rather than exotic, and the wrong number would be reported to a
 * hiring manager as a fact.
 *
 * So the fix is FO-A1's, shape for shape. `account` carries `partyRef` and every
 * counterparty read joins on it; `jobPosting` now carries `postingId` and every
 * application read joins on that. The title stays a display name.
 *
 * ── TWO DIRECTIONS, ONE TOOL ────────────────────────────────────────────────────
 * A requisition can start on either side, and both are ordinary:
 *
 *   • It exists in the workspace already (published from a ticket, or created in the
 *     Recruiter seat). Called with no arguments, this projects those postings onto the
 *     board — matched on `postingId`, created when absent, refreshed when present.
 *     Exactly `canvas_sync_account`'s default behaviour.
 *
 *   • It was drafted ON the board, in a conversation, and has no backend row yet.
 *     Called with that card's `objectId`, this MINTS the row from what the card holds
 *     and writes the new id back onto it in the same call.
 *
 * One tool rather than two because the caller cannot reliably tell which case it is in
 * — a card either carries a `postingId` or it does not — and a model asked to choose
 * between `canvas_create_job_posting` and `canvas_refresh_job_posting` will eventually
 * choose create for a card that already had a row, which is how one requisition becomes
 * two pipelines.
 *
 * ── WHAT IT WILL NOT DO ─────────────────────────────────────────────────────────
 * It never resolves a card to a posting BY TITLE, in either direction. A card whose
 * `postingId` does not resolve reports that and stops; it does not fall back to a
 * search, because a fallback that is right most of the time is the failure this whole
 * family exists to remove. It also never writes `distribution` or `postingUrl` — those
 * belong to the distribute action and a connected job board, and a URL nobody
 * confirmed does not resolve.
 *
 * ── WHY A MODULE AND NOT MORE OF CreationCanvas.tsx ─────────────────────────────
 * The same argument `canvasFounderOpsTools.ts` makes: these are pure functions over an
 * injected context, so the projection can be unit-tested without React or a board.
 */

import type { BrainAction } from '@seanhogg/builderforce-brain-embedded';
import { atsApi, type CanvasPosting, type CanvasPostingDraft } from '@/lib/hiringApi';
import type { CanvasFounderOpsContext } from '@/lib/canvasFounderOpsTools';

/** Cap on how many requisitions one sync will author. A board is a working surface; an
 *  agency's whole req list is an export, and the Recruiter seat is where that belongs.
 *  Matches `canvas_sync_account`'s reasoning and its number. */
const MAX_POSTINGS = 25;

const text = (value: unknown, max = 200): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const chips = (value: unknown, max = 30): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map((item) => item.trim())
      .slice(0, max)
    : [];

/**
 * How a card's `employmentType` becomes the posting's SHAPE.
 *
 * `job_postings` carries two shape columns and they answer different questions:
 * `posting_type` is what kind of thing this is (an FTE requisition, a project put out
 * to bid, a design gig) and `engagement_type` is how it is paid (a salary, a fixed
 * price, an hourly rate). The escrow gate reads the second and treats an unstated
 * shape as not-fixed-price, so leaving it silent is not neutral.
 *
 * Data rather than a chain of `if`s, and DELIBERATELY partial: an employment type this
 * map does not know leaves both columns unset and lets `upsertJobPosting` apply its own
 * documented default, rather than this file inventing a third opinion about what
 * "internship" is worth.
 */
const POSTING_SHAPE: Readonly<Record<string, { postingType: string; engagementType: string }>> = {
  permanent: { postingType: 'fte', engagementType: 'fte' },
  'fixed-term': { postingType: 'fte', engagementType: 'fte' },
  'part-time': { postingType: 'fte', engagementType: 'fte' },
  internship: { postingType: 'fte', engagementType: 'fte' },
  contract: { postingType: 'project_bid', engagementType: 'fixed_bid' },
};

/** The inverse, for a card being drawn FROM a posting. Only the unambiguous direction
 *  is mapped: `fixed_bid` and `hourly` are both contract work to a recruiter, and
 *  `fte` is the only one that names an employment type on its own. */
const EMPLOYMENT_TYPE: Readonly<Record<string, string>> = {
  fte: 'permanent',
  fixed_bid: 'contract',
  hourly: 'contract',
};

/**
 * What a board-drafted card contributes when it mints its posting.
 *
 * Exported and pure so the mapping can be asserted directly. Three things are
 * deliberately NOT mapped:
 *
 *   • `compBand` — a canvas band is human prose ("£85–95k, DOE") by design, and
 *     `job_postings` wants integer minor units. Parsing it would either lose the
 *     qualifier or invent a precision the recruiter never stated, and an invented
 *     salary on a published posting is a worse error than an absent one.
 *   • `level` — "Senior (L5)" is this company's word for seniority; `experience_level`
 *     is a closed vocabulary (entry | intermediate | expert). Mapping between them is
 *     a guess, and a guess here silently re-pitches the role.
 *   • `headcount` / `targetStartDate` — no column holds them. Recording them somewhere
 *     approximate would make the card and the row disagree about what they mean.
 *
 * All three stay on the card, which is where the recruiter can see them.
 */
export function postingDraftFromCard(data: Record<string, unknown>, title: string): CanvasPostingDraft {
  const employmentType = text(data.employmentType, 32).toLowerCase();
  const shape = POSTING_SHAPE[employmentType];
  const mustHaves = chips(data.mustHaves);
  const niceToHaves = chips(data.niceToHaves);
  // The posting BODY, composed from the two fields a recruiter actually writes. The
  // summary is the pitch and the responsibilities are the work; a posting that carries
  // only one of them reads as either an advert with no job in it or a job description
  // nobody applies to.
  const responsibilities = Array.isArray(data.responsibilities)
    ? (data.responsibilities as Array<Record<string, unknown>>)
      .map((row) => [text(row?.title, 120), text(row?.detail, 400)].filter(Boolean).join(' — '))
      .filter(Boolean)
    : [];
  const description = [text(data.summary, 2000), ...responsibilities].filter(Boolean).join('\n\n');

  return {
    title,
    ...(description ? { description: description.slice(0, 5000) } : {}),
    // The acceptance bar, which is what `requirements` is for on the row. Only the
    // must-haves: a nice-to-have a candidate is NOT rejected for lacking does not
    // belong in the thing they are screened against.
    ...(mustHaves.length ? { requirements: mustHaves.join('\n') } : {}),
    ...(mustHaves.length || niceToHaves.length ? { skills: [...mustHaves, ...niceToHaves].slice(0, 30) } : {}),
    ...(shape ? shape : {}),
  };
}

/**
 * The one-line reading of a posting, for the card's `summary`.
 *
 * Names WHAT was counted and WHEN, for the reason `payRunFieldsFrom` does: a count
 * whose age is invisible gets quoted a week later as though it were live. The
 * unreviewed number leads when there is one, because "nine nobody has looked at" is the
 * sentence a recruiter can act on and "forty-one applicants" is not.
 */
export function postingSummary(posting: CanvasPosting, at: string): string {
  const when = at.slice(0, 16).replace('T', ' ');
  if (posting.applicantCount === 0) {
    return `No applications yet against this posting. Read from the hiring domain at ${when} — `
      + 'this card is a handle on the requisition, not a copy of it, so the count refreshes rather than being typed.';
  }
  const people = posting.applicantCount === 1 ? 'application' : 'applications';
  const unreviewed = posting.unreviewedCount > 0
    ? `${posting.unreviewedCount} of them not yet looked at. `
    : '';
  const top = posting.sources[0];
  const source = top ? `Most came from ${top.source} (${top.count}). ` : '';
  return `${posting.applicantCount} ${people}, ${posting.activeApplicantCount} still in play, `
    + `${posting.rejectedCount} rejected. ${unreviewed}${source}`
    + `Read from the hiring domain at ${when} — this card is a handle on the requisition, not a copy of it, `
    + 'so refresh the count rather than typing it.';
}

/**
 * The canvas `jobPosting` fields one projected posting writes.
 *
 * The record's fields WIN over the card's for everything the record owns — status, the
 * counts, the id — and the card keeps everything the record has no column for. That
 * asymmetry is the point: the board must not be able to talk the record out of what it
 * says, and the record must not blank the comp band a recruiter typed.
 */
export function jobPostingFieldsFrom(posting: CanvasPosting, at: string): Record<string, unknown> {
  const employmentType = posting.engagementType ? EMPLOYMENT_TYPE[posting.engagementType] : undefined;
  return {
    postingId: posting.postingId,
    status: posting.status,
    applicantCount: posting.applicantCount,
    ...(employmentType ? { employmentType } : {}),
    // The posting's OWN seniority word, not a translation of the card's. Absent where
    // the row never stated one, which reads as unknown rather than as "entry".
    ...(posting.experienceLevel ? { level: posting.experienceLevel } : {}),
    summary: postingSummary(posting, at),
  };
}

const NO_TENANT = 'This needs a signed-in, saved canvas session: a job posting is a workspace record and an anonymous board has no workspace behind it. Say so in one sentence and author the requisition on the board so it is ready to publish — never claim it was published.';

export function canvasHiringPostingActions(ctx: CanvasFounderOpsContext): BrainAction[] {
  const guard = (): { error: string } | null => {
    if (!ctx.hasTenant) return { error: NO_TENANT };
    if (!ctx.canEdit) return { error: 'The current session role cannot edit this canvas' };
    return null;
  };

  return [
    {
      name: 'canvas_sync_job_posting',
      description:
        'Bind the canvas\'s `jobPosting` cards to the workspace\'s REAL job postings, and read the applications counted against each one. Call this before answering anything about applicant volume, who has applied, or how a requisition is doing — the numbers are counted from the hiring domain and must never be typed onto the card. With no arguments it puts every real posting on the board, creating a card when absent and refreshing it when present. With `objectId` it takes a requisition drafted on the board that has no backend row yet, CREATES that row, and writes its id back onto the card — do that before shortlisting, interviewing or making an offer against it, because a card with no `postingId` has no pipeline and its applications have nothing to attach to. A card whose id no longer resolves is reported, never silently re-created.',
      parameters: {
        type: 'object', additionalProperties: false,
        properties: {
          objectId: {
            type: 'string',
            description: 'A `jobPosting` card on this board. Given one that already carries a `postingId`, this refreshes it; given one that does not, this creates the real posting from what the card holds. Omit to project every posting the workspace has instead.',
          },
          status: {
            type: 'string',
            enum: ['open', 'closed', 'filled'],
            description: 'Only project postings in this state. Omit for all of them. Ignored when `objectId` is given.',
          },
          limit: { type: 'number', minimum: 1, maximum: MAX_POSTINGS },
          x: { type: 'number' }, y: { type: 'number' },
        },
      },
      mutates: () => true,
      run: async (raw: unknown) => {
        const blocked = guard();
        if (blocked) return blocked;
        const args = raw as { objectId?: string; status?: string; limit?: number; x?: number; y?: number };
        const at = new Date().toISOString();
        const place = { ...(args.x != null ? { x: args.x } : {}), ...(args.y != null ? { y: args.y } : {}) };

        // ── One card: refresh it, or give it a real row ────────────────────────────
        if (args.objectId) {
          const card = ctx.objects().find((object) => object.id === args.objectId);
          if (!card || card.kind !== 'jobPosting') {
            return { error: 'objectId must name a `jobPosting` object on this canvas.' };
          }
          const title = text(card.title, 200);
          if (!title) {
            return { error: 'This requisition has no title, and a posting cannot be created without one. Give the card the role title candidates would search for first.' };
          }
          const existingId = text(card.data.postingId, 64);
          let result: { posting: CanvasPosting; created: boolean };
          try {
            result = await atsApi.postings.sync(existingId
              ? { postingId: existingId }
              : { draft: postingDraftFromCard(card.data, title) });
          } catch (error) {
            // A `postingId` that does not resolve is a 404 with a sentence on it. It is
            // reported rather than retried as a create, for the reason the module note
            // gives: minting a second requisition for a mistyped id splits the pipeline
            // and nothing about the board looks wrong afterwards.
            return {
              postingSynced: false,
              error: error instanceof Error ? error.message : 'That posting could not be synced.',
              ...(existingId ? {
                instruction: `This card names posting ${existingId}, which this workspace does not have. Say so and ask whether it was deleted or belongs to another workspace. Do NOT clear the id and create a new posting — that would split the applications already recorded against the original.`,
              } : {}),
            };
          }
          ctx.updateObject(
            card.id,
            jobPostingFieldsFrom(result.posting, at),
            result.created ? `Published ${result.posting.title}` : `Refreshed ${result.posting.title}`,
          );
          return {
            ok: true, proposed: true, postingSynced: true,
            created: result.created,
            objectId: card.id,
            postingId: result.posting.postingId,
            pipelineRef: result.posting.pipelineRef,
            applicantCount: result.posting.applicantCount,
            activeApplicantCount: result.posting.activeApplicantCount,
            unreviewedCount: result.posting.unreviewedCount,
            rejectedCount: result.posting.rejectedCount,
            sources: result.posting.sources,
            instruction: result.created
              ? 'This requisition now exists in the workspace and has an id. Use that `postingId` as `postingRef` on any shortlist you build against it, so the ranking joins to the posting rather than to two spellings of its title.'
              : 'Lead with what changed since the card last said something — new applications, and how many nobody has reviewed. These counts were read just now; report them with that.',
          };
        }

        // ── Every posting the workspace holds ──────────────────────────────────────
        let postings: CanvasPosting[];
        try {
          postings = await atsApi.postings.list(args.status ? { status: args.status } : {});
        } catch (error) {
          return { postingsFound: false, error: error instanceof Error ? error.message : 'The workspace postings could not be read.' };
        }

        if (!postings.length) {
          return {
            postingsFound: false,
            reason: args.status ? 'no-match' : 'no-postings',
            instruction: args.status
              ? `This workspace has no ${args.status} postings. Say so plainly rather than drawing an empty card.`
              : 'This workspace has no job postings yet. Author the requisition on the board from what the user tells you — the role, the level, the must-haves — and then call this tool again with that card\'s objectId to create the real posting. Do NOT invent an applicantCount for it: a requisition that does not exist has had nobody apply to it.',
          };
        }

        const limit = Math.max(1, Math.min(Math.round(args.limit ?? MAX_POSTINGS), MAX_POSTINGS));
        const existing = ctx.objects().filter((object) => object.kind === 'jobPosting');
        const targets = postings.slice(0, limit);
        const synced: Array<{ objectId: string; title: string; postingId: string; applicantCount: number; updated: boolean }> = [];

        for (const posting of targets) {
          const fields = jobPostingFieldsFrom(posting, at);
          // Matched on `postingId` and NOT on title, for the reason `canvas_sync_account`
          // matches on `partyRef`: the id is the identity, and a requisition whose title
          // was reworded after it went live would otherwise land on the board twice.
          const match = existing.find((object) => text(object.data.postingId, 64) === posting.postingId);
          if (match) {
            ctx.updateObject(match.id, fields, `Refreshed ${posting.title}`);
            synced.push({ objectId: match.id, title: posting.title, postingId: posting.postingId, applicantCount: posting.applicantCount, updated: true });
          } else {
            const { objectId } = ctx.addObject('jobPosting', { title: posting.title, ...fields }, place);
            synced.push({ objectId, title: posting.title, postingId: posting.postingId, applicantCount: posting.applicantCount, updated: false });
          }
        }

        return {
          ok: true, proposed: true, postingsFound: true,
          postings: synced,
          ...(postings.length > limit ? { moreAvailable: postings.length - limit } : {}),
          instruction: 'Every count here was read from the hiring domain just now. Use each card\'s `postingId` — never its title — as the `postingRef` on a shortlist or the posting named when recording an application, so the funnel, the board and this card are all one requisition.',
        };
      },
    },
  ];
}
