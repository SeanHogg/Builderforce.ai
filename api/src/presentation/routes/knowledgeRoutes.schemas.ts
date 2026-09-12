/**
 * Request-body schemas for `knowledgeRoutes.ts` — split out so the 1,300-line
 * route module does not grow by its own contract.
 *
 * Each mirrors the body its handler declared AND what it actually reads. A field
 * the handler answers its own "X is required" sentence for stays OPTIONAL, so that
 * sentence is still what a missing field gets. Vocabulary fields the handler checks
 * itself and FALLS BACK on (`docType`, `status`, `role`, `visibility`) stay plain
 * strings: an unknown value was always tolerated there, and the schema's job is the
 * shape — a `tags: "x"` or a `userIds: 5` is a 400 naming the field instead of a
 * TypeError answered as a 500.
 */
import { z, zNumberLike } from './requestBody';

/** Tag lists go through `normaliseTags`, which drops non-strings and blanks itself. */
const zTagList = z.array(z.unknown()).nullish();

/** `POST /documents` — every field optional: a template or a default fills it. */
export const CreateDocumentBody = z.object({
  title: z.string().nullish(),
  summary: z.string().nullish(),
  content: z.string().nullish(),
  docType: z.string().nullish(),
  projectId: z.number().nullish(),
  requiresAck: z.boolean().nullish(),
  tags: zTagList,
  /** Start from a curated standard-library template (fills title/content/docType/tags). */
  templateKey: z.string().nullish(),
});

/** `PATCH /documents/:id` — `summary` and `projectId` accept `null` to clear. */
export const UpdateDocumentBody = z.object({
  title: z.string().optional(),
  summary: z.string().nullish(),
  content: z.string().optional(),
  docType: z.string().nullish(),
  projectId: z.number().nullish(),
  requiresAck: z.boolean().optional(),
  status: z.string().nullish(),
});

/** `POST /documents/:id/publish` — the change note is optional, and so is the body. */
export const PublishDocumentBody = z.object({ changeNote: z.string().nullish() });

/** `PUT /documents/:id/tags`. */
export const ReplaceTagsBody = z.object({ tags: zTagList });

/** `POST /documents/:id/collaborators` — any role but `viewer` reads as `editor`, as before. */
export const AddCollaboratorBody = z.object({
  userId: z.string().nullish(),
  role: z.string().nullish(),
});

/** `POST /documents/:id/training` — the handler refuses an empty list and a bad date itself. */
export const AssignTrainingBody = z.object({
  userIds: z.array(z.string()).nullish(),
  dueAt: z.string().nullish(),
});

/** `POST /ai/draft` — the handler refuses a missing prompt itself. */
export const AiDraftBody = z.object({
  prompt: z.string().nullish(),
  docType: z.string().nullish(),
  title: z.string().nullish(),
  existingContent: z.string().nullish(),
});

/** `POST /documents/:id/list` — the price is `Number(...)`ed; absent fields take their defaults. */
export const ListDocumentBody = z.object({
  priceCents: zNumberLike.nullish(),
  currency: z.string().nullish(),
  category: z.string().nullish(),
  visibility: z.string().nullish(),
});

/** `POST /listings/:listingId/checkout` — both fields optional, and so is the body. */
export const KnowledgeCheckoutBody = z.object({
  returnUrl: z.string().nullish(),
  buyerEmail: z.string().nullish(),
});

/** `POST /listings/:listingId/checkout/complete` — the handler refuses a missing id itself. */
export const CompleteKnowledgeCheckoutBody = z.object({ checkoutSessionId: z.string().nullish() });
