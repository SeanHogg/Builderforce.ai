/**
 * Request-body schemas for `brainRoutes` (`/api/brain/*`).
 *
 * Each mirrors what its handler — and the BrainService / ChatTicketService method
 * it hands the body to — actually reads. Two rules keep valid requests unchanged:
 *   - a field the handler answers its OWN "X is required" sentence for stays
 *     optional, so that sentence (not a schema message) still answers its absence;
 *   - a field the handler or service already type-guards stays `z.unknown().optional()`.
 * What the schemas add is the SHAPE: a body whose fields are the wrong kind of
 * value is a 400 naming the field, where it used to reach `.trim()` / `.map()` /
 * `.role` and die as a 500.
 */
import { z, zNumberLike, zOptionalString } from './requestBody';
import type { AppendMessagesDto, BrainTraceEventInput } from '../../application/brain/BrainService';

const isObjectLike = (value: unknown): boolean => typeof value === 'object' && value !== null && !Array.isArray(value);

/** POST /chats. `createChat` reads `title?.trim() || 'New chat'`, so trimming and ""/null → absent change nothing. */
export const CreateChatBody = z.object({
  title: zOptionalString,
  projectId: z.number().nullish(),
  capability: z.string().nullish(),
  mode: z.string().nullish(),
});

/** PATCH /chats/:id — `UpdateChatDto`. `title` is `.trim()`med when present, so it must be a string. */
export const UpdateChatBody = z.object({
  title: z.string().optional(),
  projectId: z.number().nullish(),
  visibility: z.enum(['shared', 'locked']).optional(),
  capability: z.string().nullish(),
  mode: z.string().nullish(),
});

/** POST /chats/:id/read — a non-number `seq` has always meant "mark everything read". */
export const MarkReadBody = z.object({ seq: z.unknown().optional() });

/**
 * POST /chats/:id/messages. Each turn must be an object (the route reads `.role`,
 * `.content`, `.metadata` off every one); the per-field rules — skip a turn with no
 * role or non-string content — belong to `appendRaw`, which keeps owning them.
 * Optional so an absent list still answers the service's "messages array is required".
 */
export const AppendMessagesBody = z.object({
  messages: z.array(z.custom<AppendMessagesDto['messages'][number]>(isObjectLike, 'each message must be an object')).optional(),
});

/**
 * POST /chats/:id/trace. `appendTrace` filters out any event without a string `kind`
 * and normalizes every other field itself, so an element only has to be an object.
 */
export const AppendTraceBody = z.object({
  events: z.array(z.custom<BrainTraceEventInput>(isObjectLike, 'each event must be an object')).optional(),
});

/** POST /chats/:id/tickets. `ref` is `String()`ed, so a numeric id is as good as a string one. */
export const LinkTicketBody = z.object({
  kind: z.string().optional(),
  ref: z.union([z.string(), z.number()]).nullish(),
  linkType: z.enum(['linked', 'created']).optional(),
});

/** POST /chats/consolidate. Both ids are `Number()`ed by the route. */
export const ConsolidateChatsBody = z.object({
  targetChatId: zNumberLike.nullish(),
  sourceChatIds: z.array(zNumberLike).nullish(),
});

/** POST /chats/claim-guest-room — both fields go through their own validators (`isValidRoomCode`, `isValidVisitorId`). */
export const ClaimGuestRoomBody = z.object({ code: z.unknown().optional(), visitorId: z.unknown().optional() });

/**
 * POST /chats/:id/agents. `agentRef` is `String()`ed (an agent id may arrive as a
 * number); `agentKind`/`role` fall back with `||`, so "" / null read as absent.
 */
export const InviteAgentBody = z.object({
  agentRef: zNumberLike.nullish(),
  agentKind: zOptionalString,
  role: zOptionalString,
});

/** POST /chats/:id/members. */
export const InviteMemberBody = z.object({ email: z.string().nullish() });

/** POST /chats/:id/agent-reply. `agentReply` reads `agentName?.trim() || 'the agent'`. */
export const AgentReplyBody = z.object({
  agentRef: zNumberLike.nullish(),
  agentName: zOptionalString,
});

/** POST /fetch-url — the route type-checks `url` itself ("A url is required"). */
export const FetchUrlBody = z.object({ url: z.unknown().optional() });

/** PATCH /messages/:id/feedback — `feedback` is checked by hand ("Invalid feedback value"). */
export const MessageFeedbackBody = z.object({
  feedback: z.unknown().optional(),
  toolName: z.string().nullish(),
  actionType: z.string().nullish(),
});
