/**
 * Guest (logged-out) chat handler for `POST /v1/chat/completions`.
 *
 * A LOGGED-OUT visitor can try the Brain before signing up. Their request
 * carries a `bfguest_*` token (minted at `/api/guest/session`) instead of a
 * tenant JWT, so the main handler routes here BEFORE `requireTenantAccess` — the
 * tenant auth/metering path never sees anonymous traffic. Deliberately minimal
 * and isolated from the tenant machinery:
 *   • cheapest FREE pool, only local Canvas tools, small max_tokens (cost containment);
 *   • metered per visitorId AND per IP (GuestChatService) with a tiny cap;
 *   • NO tenant usage rows written (a guest has no tenant), so guest spend never
 *     touches `llm_usage_log` or any tenant meter.
 * Cap exhaustion returns a 402 the UI turns into a "sign up free to keep going"
 * wall — the whole point of the funnel.
 *
 * A guest token may also carry a signed room code (`rid`) — a SHARED session the
 * guest invited other people into. Then a THIRD axis applies, and it is the one
 * the UI counts down: the room's COMBINED allowance. It is the same ten turns a
 * lone guest gets, spent by everybody in the room together, so an invite link can
 * never multiply anonymous spend. The per-visitor and per-IP counters keep running
 * underneath it, so joining a fresh room cannot refill an exhausted individual
 * either — a turn must clear ALL THREE to be dispatched.
 */
import type { Context } from 'hono';
import type { Env, HonoEnv } from '../../../env';
import { RequestValidationError } from '../../../domain/shared/errors';
import { sha256Hex } from '../../../domain/shared/hash';
import { GUEST_CHAT_LIMITS } from '../../../domain/tenant/PlanLimits';
import { reportCaughtError } from '../../../application/observability/caughtErrorReporter';
import { ChatCompletionBody, gatewayRefusalBody, parseGatewayBody } from '../llmRoutes.schemas';
import {
  llmProxyForPlan,
  newTraceId,
  estimateRequestTokens,
  type ChatCompletionRequest,
} from '../../../application/llm/LlmProxyService';
import { wrapStreamForTrace } from '../../../application/llm/streamTrace';
import { requestDb } from '../../../application/shared/dbHandle';
import { GuestChatService } from '../../../application/guest/GuestChatService';
import { GuestPromptService } from '../../../application/marketing/GuestPromptService';
import { verifyGuestToken, guestBrainEnabled } from '../../../application/guest/guestToken';
import { guestRoomTurn } from '../../../application/guest/guestRoomClient';
import { restrictGuestTools } from '../../../application/guest/guestCanvasTools';
import { isAgenticToolTurn } from '../../../application/llm/gatewayCompletionProxy';
import { logFailovers } from '../../../application/llm/gatewayUsageLog';

async function guestTurnFingerprint(messages: ChatCompletionRequest['messages'], originalUserInput?: string): Promise<string> {
  // Tool-loop continuations append assistant/tool messages, while the system and
  // user messages remain unchanged. Hash only that stable user-authored spine so
  // retries within one submit dedupe, but reusing an id for different input does not.
  const stableInput = originalUserInput != null
    ? JSON.stringify(originalUserInput.slice(0, 8_000))
    : JSON.stringify(messages.filter((message) => message.role === 'system' || message.role === 'user'));
  return sha256Hex(stableInput);
}

export async function handleGuestChat(c: Context<HonoEnv>): Promise<Response> {
  if (!guestBrainEnabled(c.env)) {
    return c.json({ error: 'Guest chat is disabled.', code: 'guest_brain_disabled' }, 503);
  }
  const authHeader = c.req.header('Authorization') ?? '';
  const token = authHeader.slice(7); // strip "Bearer "
  const identity = await verifyGuestToken(token, c.env.JWT_SECRET);
  if (!identity) {
    return c.json({ error: 'Invalid or expired guest session.', code: 'guest_token_invalid' }, 401);
  }
  const { visitorId, roomCode } = identity;

  const parsed = await parseGatewayBody(c, ChatCompletionBody);
  if (parsed instanceof RequestValidationError) {
    return c.json(gatewayRefusalBody(parsed, 'messages array is required', 'messages'), 400);
  }
  if (!parsed.messages || parsed.messages.length === 0) {
    return c.json({ error: 'messages array is required' }, 400);
  }
  const body: ChatCompletionRequest = { ...parsed, messages: parsed.messages };

  const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null;
  const guest = new GuestChatService(requestDb(c));
  const metadata = (body as unknown as { metadata?: Record<string, unknown> }).metadata;
  const suppliedTurnId = typeof metadata?.guestTurnId === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(metadata.guestTurnId)
    ? metadata.guestTurnId
    : null;
  const originalUserInput = typeof metadata?.guestTurnInput === 'string' ? metadata.guestTurnInput : undefined;
  const turnFingerprint = await guestTurnFingerprint(body.messages, originalUserInput);
  // Fingerprint fallback keeps older clients from charging each appended tool
  // continuation during a rolling deploy. New clients always send a unique id.
  const turnId = suppliedTurnId ?? turnFingerprint;

  // The room's COMBINED allowance is checked first, and its numbers are the ones
  // the shared UI counts down — "3 free messages left" must mean the same thing to
  // everyone looking at the same conversation. A room that has vanished (expired,
  // or the DO binding is gone) degrades to the solo path rather than blocking.
  const roomTurn = roomCode ? await guestRoomTurn(c.env as Env, roomCode, turnId, false) : null;
  if (roomTurn && !roomTurn.allowed) {
    return c.json({
      error: `This shared session has used its ${roomTurn.limit} free messages for today. Sign up free to keep going.`,
      code: 'guest_limit_reached',
      reason: 'room',
      limit: roomTurn.limit,
      terminal: true,
    }, 429);
  }

  const cap = await guest.checkCap(c.env as Env, visitorId, ip, turnId, turnFingerprint);
  if (!cap.allowed) {
    // 429 (not 402) — a guest has no plan to upgrade, so this must NOT trip the
    // paid-plan upgrade modal. The UI shows a "sign up free to keep going" wall,
    // keyed off code `guest_limit_reached`. `terminal` so the client stops.
    return c.json({
      error: cap.reason === 'ip'
        ? 'This device has reached its free guest limit for today. Sign up free to keep going.'
        : `You've used your ${cap.limit} free guest messages for today. Sign up free to keep going.`,
      code: 'guest_limit_reached',
      reason: cap.reason,
      limit: cap.limit,
      terminal: true,
    }, 429);
  }

  // ── Cost containment: cheapest FREE pool, local-only tools, clamped output
  const bodyAny = body as Record<string, unknown>;
  // The Creation Canvas executes these operations in the browser against the
  // guest's local document. Preserve that fixed vocabulary; strip every tenant,
  // MCP, filesystem, and caller-invented tool from anonymous requests.
  restrictGuestTools(body);
  delete bodyAny.model;         // let the FREE pool pick its cheapest cascade
  delete bodyAny.modelStrict;
  // `excludeModels` DELIBERATELY survives. A guest cannot pin a model — the two
  // deletes above are what make that true — so this is the only way an anonymous
  // caller can say "that one just failed to execute my tools, give me another".
  // Stripping it here would leave a guest permanently stuck on whichever model
  // leads the free pool, which is exactly how a Canvas session bricked itself on
  // 2026-08-12. `applyExcludedModels` never empties the chain, so the cheapest
  // cascade is still guaranteed to produce a candidate.
  // A tool-carrying turn AUTHORS its artifact inside the tool call, so it needs room to
  // finish one. Clamping it to the chat-bubble budget truncated the arguments mid-JSON
  // and the turn arrived as no tool call at all — see GUEST_CHAT_LIMITS.
  const guestMaxTokens = isAgenticToolTurn(bodyAny)
    ? GUEST_CHAT_LIMITS.maxToolTokensPerRequest
    : GUEST_CHAT_LIMITS.maxTokensPerRequest;
  if (typeof body.max_tokens !== 'number' || body.max_tokens > guestMaxTokens) {
    body.max_tokens = guestMaxTokens;
  }

  const requiredKey = c.env.OPENROUTER_API_KEY;
  if (!requiredKey) {
    return c.json({ error: 'LLM proxy not configured (missing OPENROUTER_API_KEY)' }, 503);
  }

  const service = llmProxyForPlan(c.env, 'free');
  const traceId = newTraceId();
  const estimatedTokens = estimateRequestTokens(body.messages, undefined);
  const result = await service.complete(body, undefined, traceId, undefined, { estimatedTokens });

  // Harvest the visitor's own words for the funnel. The landing composer posts
  // its prompt explicitly (it fires before any model call exists); every turn
  // INSIDE a session arrives here instead, so this is where those are captured —
  // off the request path, so a canvas turn pays nothing for it, and only when the
  // client sent the original input rather than the assembled message array (a
  // tool-loop continuation carries no new human sentence and must not be logged
  // as one). `record` is idempotent about nothing and charges its own daily
  // ceiling, which is why the same service owns both entry points.
  if (originalUserInput) {
    c.executionCtx.waitUntil(
      new GuestPromptService(requestDb(c))
        .record(c.env as Env, {
          visitorId,
          prompt: originalUserInput,
          surface: roomCode ? 'room' : 'canvas',
          mode: typeof metadata?.chatMode === 'string' ? metadata.chatMode : undefined,
          sessionRef: typeof metadata?.sessionRef === 'string' ? metadata.sessionRef : undefined,
          ip,
        })
        .catch((error) => {
          reportCaughtError(error, { source: 'presentation/routes/llm/guestChat.ts', operation: 'handleGuestChat.recordPrompt' });
        }),
    );
  }

  // Charge only once an upstream has accepted the request. For streaming calls
  // this still happens before the response body is handed to the browser, so an
  // aborted stream counts; gateway/vendor failures do not burn a guest turn.
  let remaining = cap.remaining;
  let limit = cap.limit;
  if (result.response.ok && !cap.alreadyConsumed) {
    remaining = await guest.consumeMessage(c.env as Env, visitorId, ip, turnId, turnFingerprint);
  }
  // Charge the room on the same condition, and report ITS numbers — the shared
  // counter is what every participant sees. The DO makes this idempotent per
  // turnId, so a tool-loop continuation costs the room nothing extra.
  if (roomCode && result.response.ok) {
    const charged = await guestRoomTurn(c.env as Env, roomCode, turnId, true);
    if (charged) {
      remaining = charged.remaining;
      limit = charged.limit;
    }
  } else if (roomTurn) {
    remaining = roomTurn.remaining;
    limit = roomTurn.limit;
  }

  const headers = new Headers();
  const contentType = result.response.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  const retryAfter = result.response.headers.get('retry-after');
  if (retryAfter) headers.set('retry-after', retryAfter);
  headers.set('x-builderforce-model', result.resolvedModel);
  headers.set('x-builderforce-vendor', result.resolvedVendor);
  headers.set('x-builderforce-trace-id', result.traceId ?? traceId);
  headers.set('x-builderforce-retries', String(result.retries));
  headers.set('x-builderforce-guest', 'true');
  headers.set('x-builderforce-guest-remaining', String(remaining));
  headers.set('x-builderforce-guest-limit', String(limit));

  if (body.stream && result.response.body) {
    headers.set('cache-control', 'no-cache');
    headers.set('connection', 'keep-alive');
    logFailovers(c.env, c.executionCtx, result.failovers, { requestId: result.traceId ?? traceId });
    if (result.response.ok) {
      const instrumented = wrapStreamForTrace(result.response.body, {
        onUsage: (usage) => {
          c.executionCtx.waitUntil(guest.addTokens(visitorId, usage.totalTokens ?? 0));
        },
      });
      return new Response(instrumented, { status: result.response.status, headers });
    }
    return new Response(result.response.body, { status: result.response.status, headers });
  }

  const upstream = await result.response.json() as Record<string, unknown>;
  logFailovers(c.env, c.executionCtx, result.failovers, { requestId: result.traceId ?? traceId });
  if (result.response.ok) {
    c.executionCtx.waitUntil(guest.addTokens(visitorId, result.usage?.totalTokens ?? 0));
  }
  return c.json({ ...upstream, _builderforce: { guest: true, remaining, limit } }, result.response.status as 200);
}
