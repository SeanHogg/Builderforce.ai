/**
 * LTI 1.3 / LTI Advantage claim vocabulary — the DOMAIN half, with no IO.
 *
 * ── WHY LTI AND NOT THE SCORM EXPORT WE ALREADY HAD ──────────────────────────────
 * The canvas could already export a course as a SCORM 2004 package. SCORM is a
 * one-way ZIP: it carries content INTO an LMS and nothing comes back. A university
 * runs on Canvas, Moodle, Blackboard or Brightspace, and what a module lead needs is
 * the opposite direction — the roster arriving here, and the marks going back there,
 * without anybody exporting a CSV. That is LTI Advantage: a signed launch (LTI 1.3),
 * a grade service (AGS) and a roster service (NRPS).
 *
 * ── WHY THE CLAIM URIS ARE CONSTANTS AND NOT INLINE STRINGS ──────────────────────
 * Every one is a long URL that differs from its neighbour by one path segment
 * (`.../claim/context` vs `.../claim/custom`), and a typo in one produces an empty
 * claim rather than an error — a launch that silently has no roster endpoint, which
 * is indistinguishable at the call site from a platform that did not send one.
 *
 * This module is pure: it parses and validates a decoded payload. Signature
 * verification, key fetching and token exchange live in the application layer, which
 * is what keeps the claim rules testable without a network.
 */

const BASE = 'https://purl.imsglobal.org/spec/lti/claim';

export const LTI_CLAIM = {
  messageType: `${BASE}/message_type`,
  version: `${BASE}/version`,
  deploymentId: `${BASE}/deployment_id`,
  targetLinkUri: `${BASE}/target_link_uri`,
  resourceLink: `${BASE}/resource_link`,
  context: `${BASE}/context`,
  roles: `${BASE}/roles`,
  custom: `${BASE}/custom`,
  lis: `${BASE}/lis`,
  tool: `${BASE}/tool_platform`,
  ags: 'https://purl.imsglobal.org/spec/lti-ags/claim/endpoint',
  nrps: 'https://purl.imsglobal.org/spec/lti-nrps/claim/namesroleservice',
  /** Deep Linking: what the platform will accept back, and where to send it. */
  deepLinkingSettings: 'https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings',
  /** Deep Linking: the selection, on the RESPONSE. */
  contentItems: 'https://purl.imsglobal.org/spec/lti-dl/claim/content_items',
  /** Deep Linking: the platform's opaque round-trip token. Returned VERBATIM or
   *  the platform cannot match the response to the request it made. */
  deepLinkingData: 'https://purl.imsglobal.org/spec/lti-dl/claim/data',
} as const;

export const LTI_VERSION = '1.3.0';
export const LTI_MESSAGE_RESOURCE_LINK = 'LtiResourceLinkRequest';
export const LTI_MESSAGE_DEEP_LINK = 'LtiDeepLinkingRequest';
/** What we send BACK when an instructor has finished picking. Not a launch — it
 *  is a JWT the browser form-posts to `deep_link_return_url`. */
export const LTI_MESSAGE_DEEP_LINK_RESPONSE = 'LtiDeepLinkingResponse';

/** The two launch messages this tool accepts. Carried on the context so the
 *  route can branch on it: a resource-link launch OPENS a board, and a deep-link
 *  launch opens a PICKER whose answer goes back to the LMS. Both are signed the
 *  same way and both were read by the same parser, which is exactly why the
 *  distinction had to stop being dropped on the floor. */
export type LtiMessageType = typeof LTI_MESSAGE_RESOURCE_LINK | typeof LTI_MESSAGE_DEEP_LINK;

/**
 * The role URIs that decide what a launched user may do.
 *
 * ── WHY THE FULL URI AND NOT THE SHORT NAME ──────────────────────────────────────
 * A platform may send `Instructor` or the full
 * `http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor`, and the short form
 * is NOT unique: `Mentor` exists in both the membership and the institution
 * vocabularies with different meanings, and `Administrator` in the system vocabulary
 * is an LMS admin rather than a course admin. Matching on the suffix of a known
 * vocabulary is what keeps "can enter marks" from being granted to a role that merely
 * shares a word.
 */
const MEMBERSHIP = 'http://purl.imsglobal.org/vocab/lis/v2/membership#';

export const LTI_ROLE = {
  instructor: `${MEMBERSHIP}Instructor`,
  learner: `${MEMBERSHIP}Learner`,
  teachingAssistant: `${MEMBERSHIP}TeachingAssistant`,
  contentDeveloper: `${MEMBERSHIP}ContentDeveloper`,
  mentor: `${MEMBERSHIP}Mentor`,
  administrator: `${MEMBERSHIP}Administrator`,
} as const;

/** What the launched person may do here. Deliberately three, not a role list: every
 *  surface asks one of these questions and none of them asks "is this a TA". */
export type LtiCapability = 'teach' | 'assist' | 'learn';

/**
 * Roles that may see the whole cohort and enter marks.
 *
 * `TeachingAssistant` and `ContentDeveloper` are `assist`: they mark and author, and
 * they do NOT get the release/publish actions, because in most institutions releasing
 * marks to students is the module lead's accountable act. `Mentor` is a learner-facing
 * role (it can see ITS OWN mentees) and is therefore not staff — reading it as staff is
 * the most common LTI authorisation bug, because the word sounds senior.
 */
export function capabilityFromRoles(roles: readonly string[]): LtiCapability {
  const has = (role: string) => roles.some((candidate) => candidate === role || candidate === role.slice(MEMBERSHIP.length));
  if (has(LTI_ROLE.instructor) || has(LTI_ROLE.administrator)) return 'teach';
  if (has(LTI_ROLE.teachingAssistant) || has(LTI_ROLE.contentDeveloper)) return 'assist';
  return 'learn';
}

export interface LtiLaunchContext {
  /** Which message this is. `readLaunchClaims` has always ACCEPTED both and
   *  never carried the answer, so every consumer treated a deep-linking request
   *  as a resource-link launch and opened a board — inside the LMS's "add
   *  content" dialog, where a board is not what was asked for. */
  messageType: LtiMessageType;
  /** Platform issuer — with `clientId` and `deploymentId`, the identity of a
   *  registration. All three are needed: one platform can host many deployments. */
  issuer: string;
  clientId: string;
  deploymentId: string;
  /** Stable per-platform user identifier. Never an email — a platform may not send one,
   *  and an email is not stable across a name change. */
  subject: string;
  name: string;
  email: string;
  roles: readonly string[];
  capability: LtiCapability;
  /** The course. `label` is the code a person recognises ("PHYS2041"). */
  contextId: string;
  contextLabel: string;
  contextTitle: string;
  /** The specific link that was launched — one assignment, typically. */
  resourceLinkId: string;
  resourceLinkTitle: string;
  targetLinkUri: string;
  /** AGS: where marks go back. Absent when the platform did not grant the scope. */
  lineItemsUrl: string | null;
  lineItemUrl: string | null;
  agsScopes: readonly string[];
  /** NRPS: where the roster comes from. */
  membershipsUrl: string | null;
  /** `custom` parameters a deployment was configured with. */
  custom: Readonly<Record<string, string>>;
}

const str = (value: unknown, limit = 500): string =>
  typeof value === 'string' ? value.trim().slice(0, limit) : '';

const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export type LtiClaimResult =
  | { ok: true; context: LtiLaunchContext }
  | { ok: false; error: string };

/**
 * Read a VERIFIED id_token payload into a launch context.
 *
 * Called only after the signature, issuer, audience, nonce and expiry have been
 * checked — this function assumes authenticity and enforces COMPLETENESS. Every
 * failure names the missing claim, because the person reading it is an administrator
 * comparing our error against their LMS's tool configuration screen, and "invalid
 * launch" tells them nothing about which checkbox they missed.
 */
export function readLaunchClaims(payload: Readonly<Record<string, unknown>>): LtiClaimResult {
  const messageType = str(payload[LTI_CLAIM.messageType], 80);
  if (messageType !== LTI_MESSAGE_RESOURCE_LINK && messageType !== LTI_MESSAGE_DEEP_LINK) {
    return { ok: false, error: `Unsupported LTI message type "${messageType || 'missing'}".` };
  }
  if (str(payload[LTI_CLAIM.version], 20) !== LTI_VERSION) {
    return { ok: false, error: 'Launch is not LTI 1.3.' };
  }
  const deploymentId = str(payload[LTI_CLAIM.deploymentId], 200);
  if (!deploymentId) return { ok: false, error: 'Launch has no deployment_id claim.' };

  const subject = str(payload.sub, 200);
  if (!subject) return { ok: false, error: 'Launch has no subject claim.' };

  const audience = Array.isArray(payload.aud) ? str(payload.aud[0], 200) : str(payload.aud, 200);
  if (!audience) return { ok: false, error: 'Launch has no audience claim.' };

  const rawRoles = Array.isArray(payload[LTI_CLAIM.roles]) ? payload[LTI_CLAIM.roles] as unknown[] : [];
  const roles = rawRoles.map((role) => str(role, 200)).filter(Boolean).slice(0, 30);

  const context = obj(payload[LTI_CLAIM.context]);
  const resourceLink = obj(payload[LTI_CLAIM.resourceLink]);
  const ags = obj(payload[LTI_CLAIM.ags]);
  const nrps = obj(payload[LTI_CLAIM.nrps]);

  const custom = Object.fromEntries(
    Object.entries(obj(payload[LTI_CLAIM.custom]))
      .slice(0, 50)
      .map(([key, value]) => [key.slice(0, 80), str(value, 500)]),
  );

  const agsScopes = Array.isArray(ags.scope)
    ? (ags.scope as unknown[]).map((scope) => str(scope, 200)).filter(Boolean)
    : [];

  return {
    ok: true,
    context: {
      messageType: messageType as LtiMessageType,
      issuer: str(payload.iss, 300),
      clientId: audience,
      deploymentId,
      subject,
      name: str(payload.name, 200) || str(payload.given_name, 200),
      email: str(payload.email, 200),
      roles,
      capability: capabilityFromRoles(roles),
      contextId: str(context.id, 200),
      contextLabel: str(context.label, 200),
      contextTitle: str(context.title, 300),
      resourceLinkId: str(resourceLink.id, 200),
      resourceLinkTitle: str(resourceLink.title, 300),
      targetLinkUri: str(payload[LTI_CLAIM.targetLinkUri], 800),
      lineItemsUrl: str(ags.lineitems, 800) || null,
      lineItemUrl: str(ags.lineitem, 800) || null,
      agsScopes,
      membershipsUrl: str(nrps.context_memberships_url, 800) || null,
      custom,
    },
  };
}

// ---------------------------------------------------------------------------
// Deep Linking — the LMS asking us what to link to
// ---------------------------------------------------------------------------

/**
 * ── WHAT DEEP LINKING IS FOR ─────────────────────────────────────────────────
 * A resource-link launch answers "open this". Deep linking answers the question
 * BEFORE it: an instructor building a module clicks "add external tool content",
 * the LMS launches us with `LtiDeepLinkingRequest`, we show them what is on their
 * course board, and we hand back a `ContentItem` the LMS then stores as its own
 * assignment. Without it, every link has to be pasted by hand as a URL — and a
 * hand-pasted `target_link_uri` carries no resource link, which is exactly the
 * launch that cannot bind to an assignment or push a grade.
 *
 * ── WHY EVERY FIELD IS READ AND NONE ARE ASSUMED ─────────────────────────────
 * The settings claim is the platform stating its terms: what it will accept,
 * whether it will take more than one, and where the answer goes. A tool that
 * ignores `accept_types` offers a selection the platform will reject with a
 * message the instructor cannot act on, and one that ignores `accept_multiple`
 * shows checkboxes to somebody who may only pick one.
 */
export interface LtiDeepLinkingSettings {
  /** Where the response JWT is form-POSTed. Without it there is no way to
   *  answer at all, which is why `readDeepLinkingSettings` returns null. */
  returnUrl: string;
  /** `link` | `ltiResourceLink` | `file` | `html` | `image`. */
  acceptTypes: readonly string[];
  /** `iframe` | `window` | `embed`. */
  acceptPresentationDocumentTargets: readonly string[];
  /** May the instructor return more than one item in one response? */
  acceptMultiple: boolean;
  /** Should the platform create the items without a further confirmation step? */
  autoCreate: boolean;
  /** What the platform suggests the item be called, when it suggests anything. */
  title: string;
  text: string;
  /** Opaque. MUST be echoed on the response — it is how the platform matches
   *  our answer to the request, and dropping it fails the round trip with no
   *  diagnostic beyond "invalid response". */
  data: string;
}

const strList = (value: unknown, limit = 20): string[] =>
  (Array.isArray(value) ? value as unknown[] : []).map((entry) => str(entry, 80)).filter(Boolean).slice(0, limit);

/** Platforms send booleans as booleans, and two of them send `"true"`. */
const flag = (value: unknown): boolean => value === true || value === 'true';

/**
 * Read the deep-linking settings off a VERIFIED payload.
 *
 * Returns null when the claim is absent or carries no return URL — a
 * deep-linking request with nowhere to answer is not a request this tool can
 * honour, and pretending otherwise would present a picker whose Done button
 * could do nothing.
 */
export function readDeepLinkingSettings(
  payload: Readonly<Record<string, unknown>>,
): LtiDeepLinkingSettings | null {
  const settings = obj(payload[LTI_CLAIM.deepLinkingSettings]);
  const returnUrl = str(settings.deep_link_return_url, 1_000);
  if (!returnUrl) return null;
  return {
    returnUrl,
    acceptTypes: strList(settings.accept_types),
    acceptPresentationDocumentTargets: strList(settings.accept_presentation_document_targets),
    acceptMultiple: flag(settings.accept_multiple),
    autoCreate: flag(settings.auto_create),
    title: str(settings.title, 300),
    text: str(settings.text, 1_000),
    data: str(settings.data, 2_000),
  };
}

/**
 * One item handed back to the platform.
 *
 * `ltiResourceLink` and not `link`: a plain link is a bookmark the LMS opens in
 * a new tab with no signed launch behind it, so the thing it opens knows neither
 * who is looking nor which course they are in. A resource link is what makes the
 * next launch carry a `resource_link.id` — the identifier `lti_resource_bindings`
 * keys an assignment on, and the reason a grade can go back at all.
 */
export interface LtiContentItem {
  type: 'ltiResourceLink';
  url: string;
  title?: string;
  text?: string;
  /** Custom parameters the platform replays on every launch of this link. */
  custom?: Record<string, string>;
}

export interface DeepLinkingResponseInput {
  /** Ours. On the response we are the ISSUER and the platform is the audience —
   *  the mirror of a launch, and the single most common thing to get backwards. */
  clientId: string;
  issuer: string;
  deploymentId: string;
  nonce: string;
  /** The platform's opaque token from the request, echoed verbatim. */
  data: string;
  contentItems: readonly LtiContentItem[];
  /** Seconds since the epoch. Injected so this stays pure and testable. */
  nowSeconds: number;
  lifetimeSeconds?: number;
}

/**
 * The BODY of the deep-linking response JWT.
 *
 * Pure on purpose: the claims are a protocol decision and the signature is a key
 * operation, so the claims are built here and signed in
 * `application/lti/LtiService.ts`. That split is what lets the exact shape a
 * platform will accept be asserted in a test with no key material anywhere near
 * it.
 */
export function deepLinkingResponseClaims(input: DeepLinkingResponseInput): Record<string, unknown> {
  const now = input.nowSeconds;
  return {
    iss: input.clientId,
    aud: input.issuer,
    iat: now,
    exp: now + (input.lifetimeSeconds ?? 600),
    nonce: input.nonce,
    [LTI_CLAIM.deploymentId]: input.deploymentId,
    [LTI_CLAIM.messageType]: LTI_MESSAGE_DEEP_LINK_RESPONSE,
    [LTI_CLAIM.version]: LTI_VERSION,
    [LTI_CLAIM.contentItems]: input.contentItems,
    ...(input.data ? { [LTI_CLAIM.deepLinkingData]: input.data } : {}),
  };
}

/** The AGS scopes a tool needs to write a mark. Requested at registration; a platform
 *  may grant fewer, which is why `agsScopes` is carried and checked before a push. */
export const AGS_SCOPE = {
  lineItem: 'https://purl.imsglobal.org/spec/lti-ags/scope/lineitem',
  lineItemReadonly: 'https://purl.imsglobal.org/spec/lti-ags/scope/lineitem.readonly',
  score: 'https://purl.imsglobal.org/spec/lti-ags/scope/score',
  result: 'https://purl.imsglobal.org/spec/lti-ags/scope/result.readonly',
} as const;

export const NRPS_SCOPE = 'https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly';

/** Can this launch push a mark back? Checked BEFORE marking rather than at push time,
 *  so a marker is told the grades will not sync before they mark two hundred scripts. */
export function canReturnGrades(context: LtiLaunchContext): boolean {
  return !!context.lineItemsUrl && context.agsScopes.includes(AGS_SCOPE.score);
}

/**
 * One roster member, as NRPS returns them.
 *
 * `userId` is the platform subject, which is the SAME value a launch carries in `sub` —
 * that identity is what joins a submission to a roster row, and why the canvas roster's
 * `ref` must be filled from here rather than from an email.
 */
export interface LtiMember {
  userId: string;
  name: string;
  email: string;
  roles: readonly string[];
  capability: LtiCapability;
  status: 'Active' | 'Inactive' | 'Deleted';
}

export function readMembers(body: Readonly<Record<string, unknown>>): readonly LtiMember[] {
  const members = Array.isArray(body.members) ? body.members : [];
  return members.slice(0, 2_000).flatMap((raw): LtiMember[] => {
    const member = obj(raw);
    const userId = str(member.user_id, 200);
    if (!userId) return [];
    const roles = (Array.isArray(member.roles) ? member.roles as unknown[] : [])
      .map((role) => str(role, 200)).filter(Boolean);
    const status = str(member.status, 20);
    return [{
      userId,
      name: str(member.name, 200) || [str(member.given_name, 100), str(member.family_name, 100)].filter(Boolean).join(' '),
      email: str(member.email, 200),
      roles,
      capability: capabilityFromRoles(roles),
      status: status === 'Inactive' || status === 'Deleted' ? status : 'Active',
    }];
  });
}

/**
 * Project NRPS members onto the canvas cohort roster shape.
 *
 * The join is `ref` ← `userId`, deliberately: it is the same identifier the launch
 * carries, so a submission created from a launch and a roster row imported from NRPS
 * refer to the same person without a name or an email having to match.
 */
export interface CohortRosterRow {
  ref: string;
  name: string;
  email: string;
  group: string;
  status: 'enrolled' | 'withdrawn';
}

export function rosterFromMembers(members: readonly LtiMember[]): readonly CohortRosterRow[] {
  return members
    .filter((member) => member.capability === 'learn')
    .map((member) => ({
      ref: member.userId,
      name: member.name || member.userId,
      email: member.email,
      group: '',
      status: member.status === 'Active' ? 'enrolled' as const : 'withdrawn' as const,
    }));
}

/**
 * An AGS score payload.
 *
 * `activityProgress` and `gradingProgress` are required by the spec and are the two
 * fields that decide whether the LMS SHOWS the mark: a score posted as
 * `FullyGraded`/`Completed` appears to the student, and one posted as `Pending` does
 * not. That is exactly the control a marker needs — marks are entered over two weeks
 * and released once — so the release decision maps onto this pair rather than onto
 * whether we send the request at all.
 */
export interface AgsScore {
  userId: string;
  scoreGiven: number;
  scoreMaximum: number;
  comment?: string;
  released: boolean;
  timestamp: string;
}

export function agsScoreBody(score: AgsScore): Record<string, unknown> {
  return {
    userId: score.userId,
    scoreGiven: score.scoreGiven,
    scoreMaximum: score.scoreMaximum,
    ...(score.comment ? { comment: score.comment.slice(0, 4_000) } : {}),
    activityProgress: 'Completed',
    gradingProgress: score.released ? 'FullyGraded' : 'Pending',
    timestamp: score.timestamp,
    scoringUserId: score.userId,
  };
}
