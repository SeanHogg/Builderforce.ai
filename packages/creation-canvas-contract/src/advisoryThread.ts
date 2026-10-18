/**
 * Advisory Brain thread admission — the ONE question, asked of `boundaryAdmits`.
 *
 * A confirmed 1:1 stores its thread as `restricted` (a JSON marker on the opening
 * system message; brain chats have no confidentiality column). Restricted crosses
 * nothing. The founder inviting the advisor opens only `aiContext`, and only by
 * asking this contract's own ceiling (`internal`). The stored level stays
 * restricted, so share, guest, publicMedia and export stay closed. An invite is
 * not a bypass and not a second confidentiality model.
 */
import {
  boundaryAdmits,
  isConfidentialityLevel,
  type CanvasBoundary,
  type ConfidentialityLevel,
} from './people';

/** Marker on the opening system message. Brain chats have no confidentiality column. */
export const ADVISORY_THREAD_MARKER = 'advisory-thread';

/**
 * Product contract, not the kind default. `defaultConfidentialityForKind('advisory')`
 * is `internal`, which admits aiContext. A missing or illegal label resolves here
 * too — a caller cannot smuggle the thread across a boundary by writing `public`.
 */
export const ADVISORY_THREAD_CONFIDENTIALITY: ConfidentialityLevel = 'restricted';

/** What a loader returns when it would have quoted a sealed advisory thread. */
export const ADVISORY_THREAD_AI_CONTEXT_ERROR =
  'This advisory thread is not in AI context until the founder invites the advisor';

export interface AdvisoryThreadState {
  confidentiality: ConfidentialityLevel;
  /** True only after the founder explicitly invites the advisor. */
  founderInvitedAdvisor: boolean;
  /** The bound advisor. An invite for anyone else is refused. */
  hostRef?: string;
}

export function advisoryThreadConfidentiality(declared?: unknown): ConfidentialityLevel {
  if (isConfidentialityLevel(declared) && declared === ADVISORY_THREAD_CONFIDENTIALITY) return declared;
  return ADVISORY_THREAD_CONFIDENTIALITY;
}

export function sealedAdvisoryThread(hostRef?: string): AdvisoryThreadState {
  return {
    confidentiality: ADVISORY_THREAD_CONFIDENTIALITY,
    founderInvitedAdvisor: false,
    hostRef,
  };
}

/**
 * Does this thread cross `boundary`?
 *
 * Stored confidentiality is always asked of `boundaryAdmits`. Restricted crosses
 * nothing. `aiContext` is the one boundary a founder invite can open, and only
 * by asking the contract's own ceiling (`internal`) — the stored level stays
 * restricted, so share, guest, publicMedia and export stay closed.
 */
export function advisoryThreadAdmitted(state: AdvisoryThreadState, boundary: CanvasBoundary): boolean {
  const level = advisoryThreadConfidentiality(state.confidentiality);
  if (boundary === 'aiContext' && state.founderInvitedAdvisor) {
    return boundaryAdmits('internal', 'aiContext');
  }
  return boundaryAdmits(level, boundary);
}

export function advisoryThreadInAiContext(state: AdvisoryThreadState): boolean {
  return advisoryThreadAdmitted(state, 'aiContext');
}

export function encodeAdvisoryThreadMarker(
  state: AdvisoryThreadState,
  extra?: Record<string, unknown>,
): string {
  return JSON.stringify({
    marker: ADVISORY_THREAD_MARKER,
    confidentiality: advisoryThreadConfidentiality(state.confidentiality),
    founderInvitedAdvisor: state.founderInvitedAdvisor === true,
    hostRef: state.hostRef ?? null,
    ...extra,
  });
}

/** A stored marker, whether the row kept it as a JSON string or an object. */
export function readAdvisoryThreadState(metadata: unknown): AdvisoryThreadState | null {
  if (metadata == null || metadata === '') return null;
  let raw: unknown = metadata;
  if (typeof metadata === 'string') {
    try {
      raw = JSON.parse(metadata);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (record.marker !== ADVISORY_THREAD_MARKER) return null;
  return {
    confidentiality: advisoryThreadConfidentiality(record.confidentiality),
    founderInvitedAdvisor: record.founderInvitedAdvisor === true,
    hostRef: typeof record.hostRef === 'string' && record.hostRef ? record.hostRef : undefined,
  };
}

/**
 * May this chat's messages cross `boundary`?
 *
 * No advisory marker → unchanged (admitted). The first marker decides: a sealed
 * thread is skipped, an invited one is asked of `advisoryThreadAdmitted`.
 */
export function advisoryThreadHistoryAdmitted(
  messages: readonly { metadata?: unknown }[],
  boundary: CanvasBoundary = 'aiContext',
): boolean {
  for (const message of messages) {
    const state = readAdvisoryThreadState(message.metadata);
    if (!state) continue;
    return advisoryThreadAdmitted(state, boundary);
  }
  return true;
}

/** Marker fields to carry onto a copy, so a later loader can ask the same question. */
export function advisoryThreadMarkerFields(metadata: unknown): Record<string, unknown> {
  const state = readAdvisoryThreadState(metadata);
  if (!state) return {};
  return {
    marker: ADVISORY_THREAD_MARKER,
    confidentiality: state.confidentiality,
    founderInvitedAdvisor: state.founderInvitedAdvisor,
    ...(state.hostRef ? { hostRef: state.hostRef } : {}),
  };
}
