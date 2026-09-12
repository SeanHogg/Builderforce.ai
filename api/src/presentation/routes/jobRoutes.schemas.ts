/**
 * Request-body schemas for `jobRoutes.ts` — split out so the 1,500-line route
 * module does not grow by its own contract.
 *
 * Each mirrors the body its handler declared AND what it actually reads. A field
 * the handler answers its own "X is required" sentence for stays OPTIONAL here, so
 * that sentence is still what a missing field gets. A field the handler
 * `String(...)`s or `Number(...)`s accepts a string or a number ({@link zNumberLike}),
 * exactly as the coercion did. The schema's job is the SHAPE: a `filters: "x"` or an
 * `ids: 5` is a 400 naming the field instead of a TypeError answered as a 500.
 */
import { z, zJsonObject, zNumberLike } from './requestBody';

/** `POST /invites/:inviteId/respond` — an absent body (or `accept` absent) declines. */
export const InviteResponseBody = z.object({ accept: z.boolean().nullish() });

/** `POST /alerts` — `name` is `String(...)`ed and refused blank by the handler. */
export const AlertCreateBody = z.object({
  name: zNumberLike.nullish(),
  filters: zJsonObject.nullish(),
  enabled: z.boolean().nullish(),
});

/** `PATCH /alerts/:id` — every field optional; `filters` merges into the stored criteria. */
export const AlertPatchBody = z.object({
  name: z.string().nullish(),
  filters: zJsonObject.nullish(),
  enabled: z.boolean().nullish(),
});

/** `POST /extract` (JSON form) — `text` is `String(...)`ed; an absent body reads as too short. */
export const ExtractJobBody = z.object({ text: zNumberLike.nullish() });

/** `POST /:id/milestones` — `title`, `amountCents` and `sequence` are coerced by the handler. */
export const JobMilestoneBody = z.object({
  title: zNumberLike.nullish(),
  description: z.string().nullish(),
  amountCents: zNumberLike.nullish(),
  currency: z.string().nullish(),
  sequence: zNumberLike.nullish(),
  dueAt: z.string().nullish(),
});

/** `POST /proposals/:pid/decline` — the courteous reason is optional, and so is the body. */
export const DeclineProposalBody = z.object({ reason: z.string().nullish() });

/** `POST /:id/invites` — `createInvite` normalises the message and the deadline itself. */
export const JobInviteBody = z.object({
  freelancerUserId: zNumberLike.nullish(),
  message: z.string().nullish(),
  expiresInDays: zNumberLike.nullish(),
});

/**
 * `POST /` and `PATCH /:id` — a posting draft. Both readers (`upsertJobPosting` and
 * the PATCH handler) type-guard and normalise every field one by one, so the route
 * admits any JSON object and leaves the per-field rules where they already live.
 */
export const JobPostingBody = zJsonObject;

/** `POST /:id/proposals` — the schedule and the screening answers have their own normalisers. */
export const ProposalBody = z.object({
  coverNote: z.string().nullish(),
  rateCents: z.number().nullish(),
  milestones: z.unknown().optional(),
  screeningAnswers: z.unknown().optional(),
});

/** `POST /notifications/read` — no body, or no `ids`, marks everything read. */
export const NotificationReadBody = z.object({ ids: z.array(zNumberLike).nullish() });
