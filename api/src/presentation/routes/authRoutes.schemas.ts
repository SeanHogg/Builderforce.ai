/**
 * Request-body schemas for `authRoutes.ts` — a sibling module because that router
 * is already large enough that twenty schemas inline would grow it further.
 *
 * Every schema mirrors what its handler reads, and no more:
 *  - A field the handler checks by hand (`if (!body.email || !body.password)`) is
 *    `.nullish()` here, so the handler's own sentence ("email and password are
 *    required") still answers — sign-in and sign-up screens display those strings.
 *  - A field read only as `=== true` stays `z.unknown().optional()`: `"true"` was
 *    refused with a specific message before and still is. (`.optional()` is not
 *    decoration — in zod 4 a bare `z.unknown()` object key is REQUIRED.)
 *  - Nothing is trimmed here. Passwords, codes and session names are handed on
 *    exactly as sent; the handlers trim what they always trimmed.
 *
 * The schema's job is the SHAPE: `{"email": 42}` is a 400 naming `email`, not a
 * TypeError from `.toLowerCase()` answered as a 500.
 */
import { z } from './requestBody';

// ── Legal ────────────────────────────────────────────────────────────────────

export const AcceptTermsBody = z.object({ version: z.string().nullish() });

// ── API-key flow (SDK / CLI / agent hosts) ───────────────────────────────────

/** `AuthService.register` takes the body as its DTO; both fields are required there. */
export const ApiKeyRegisterBody = z.object({ email: z.string(), tenantId: z.number() });

export const ApiKeyTokenBody = z.object({ apiKey: z.string(), tenantId: z.number() });

/** `/tenant-api-key-token` and `/agentHost-token`: the handler answers a missing key itself. */
export const ApiKeyBody = z.object({ apiKey: z.string().nullish() });

/** Self-service revoke accepts the key under either name. */
export const RevokeKeyBody = z.object({ apiKey: z.string().nullish(), key: z.string().nullish() });

// ── Device-code sign-in (RFC 8628-style, editor clients) ─────────────────────

export const DeviceCodeBody = z.object({ client: z.string().nullish() });

/** `decision` is only compared with `'deny'`; anything else approves, so no enum. */
export const DeviceApproveBody = z.object({
  userCode: z.string().nullish(),
  user_code: z.string().nullish(),
  tenantId: z.number().nullish(),
  decision: z.string().nullish(),
});

export const EditorKeyBody = z.object({ tenantId: z.number().nullish() });

export const DeviceTokenBody = z.object({ device_code: z.string().nullish() });

// ── Web / marketplace auth ───────────────────────────────────────────────────

export const WebRegisterBody = z.object({
  email: z.string().nullish(),
  username: z.string().nullish(),
  password: z.string().nullish(),
  agreeToTerms: z.unknown().optional(),
  accountType: z.string().nullish(),
  anonId: z.string().nullish(),
  referralCode: z.string().nullish(),
  ageAttested: z.unknown().optional(),
});

export const VerifyRegistrationBody = z.object({
  email: z.string().nullish(),
  code: z.string().nullish(),
  trustDevice: z.unknown().optional(),
  sessionName: z.string().nullish(),
});

export const ResendVerificationBody = z.object({ email: z.string().nullish() });

export const WebLoginBody = z.object({
  email: z.string().nullish(),
  password: z.string().nullish(),
  sessionName: z.string().nullish(),
});

export const MfaLoginBody = z.object({
  mfaToken: z.string().nullish(),
  code: z.string().nullish(),
  recoveryCode: z.string().nullish(),
  sessionName: z.string().nullish(),
});

// ── The signed-in user's own account ─────────────────────────────────────────

export const AccountTypeBody = z.object({
  accountType: z.string().nullish(),
  ageAttested: z.unknown().optional(),
});

/**
 * `psychometric` is sanitized by `sanitizePsychometricProfile` (null clears it), so
 * it stays `unknown`. `displayName` is trimmed by the handler; null was never
 * accepted (it threw on `.trim()`), so it is a string or absent.
 */
export const UpdateMeBody = z.object({
  psychometric: z.unknown().optional(),
  displayName: z.string().optional(),
});

/**
 * Progress is re-validated field-by-field by `parseOnboardingProgress`, which
 * degrades anything malformed to its own 400 — so any JSON object is the shape.
 */
export const OnboardingProgressBody = z.record(z.string(), z.unknown());

export const OnboardingCompleteBody = z.object({ intent: z.array(z.string()).nullish() });

export const TenantTokenBody = z.object({ tenantId: z.number().nullish() });

// ── MFA management ───────────────────────────────────────────────────────────

export const MfaEnableBody = z.object({ code: z.string().nullish() });

/** Disable and recovery-code regeneration: a TOTP code OR a recovery code. */
export const MfaCodeBody = z.object({
  code: z.string().nullish(),
  recoveryCode: z.string().nullish(),
});
