import { toNumber } from "../format.ts";
import type { GatewayBrowserClient } from "../gateway.ts";
import type { SessionsListResult } from "../types.ts";

// Title validation constants (matches PRD: 1-100 characters for chat titles)
const MIN_TITLE_LENGTH = 1;
const MAX_TITLE_LENGTH = 100;

/**
 * Validates a session title according to FR3 of the PRD.
 * - Must be between MIN_TITLE_LENGTH and MAX_TITLE_LENGTH characters
 * - Cannot contain control characters (Unicode Category C)
 *
 * @param title - Title text to validate (will be trimmed)
 * @returns true if valid, false otherwise
 */
function isValidTitle(title: string): boolean {
  const trimmed = title.trim();
  // Length validation
  if (trimmed.length < MIN_TITLE_LENGTH || trimmed.length > MAX_TITLE_LENGTH) {
    return false;
  }
  // Forbidden characters validation (control characters and null byte)
  if (/^\p{C}/u.test(trimmed)) {
    return false;
  }
  return true;
}

export type SessionsState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  sessionsLoading: boolean;
  sessionsResult: SessionsListResult | null;
  sessionsError: string | null;
  sessionsFilterActive: string;
  sessionsFilterLimit: string;
  sessionsIncludeGlobal: boolean;
  sessionsIncludeUnknown: boolean;
};

export async function loadSessions(
  state: SessionsState,
  overrides?: {
    activeMinutes?: number;
    limit?: number;
    includeGlobal?: boolean;
    includeUnknown?: boolean;
  },
) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.sessionsLoading) {
    return;
  }
  state.sessionsLoading = true;
  state.sessionsError = null;
  try {
    const includeGlobal = overrides?.includeGlobal ?? state.sessionsIncludeGlobal;
    const includeUnknown = overrides?.includeUnknown ?? state.sessionsIncludeUnknown;
    const activeMinutes = overrides?.activeMinutes ?? toNumber(state.sessionsFilterActive, 0);
    const limit = overrides?.limit ?? toNumber(state.sessionsFilterLimit, 0);
    const params: Record<string, unknown> = {
      includeGlobal,
      includeUnknown,
    };
    if (activeMinutes > 0) {
      params.activeMinutes = activeMinutes;
    }
    if (limit > 0) {
      params.limit = limit;
    }
    const res = await state.client.request<SessionsListResult | undefined>("sessions.list", params);
    if (res) {
      state.sessionsResult = res;
    }
  } catch (err) {
    state.sessionsError = String(err);
  } finally {
    state.sessionsLoading = false;
  }
}

export async function patchSession(
  state: SessionsState,
  key: string,
  patch: {
    label?: string | null;
    thinkingLevel?: string | null;
    verboseLevel?: string | null;
    reasoningLevel?: string | null;
  },
) {
  if (!state.client || !state.connected) {
    return;
  }
  const params: Record<string, unknown> = { key };
  if ("label" in patch) {
    params.label = patch.label;
  }
  if ("thinkingLevel" in patch) {
    params.thinkingLevel = patch.thinkingLevel;
  }
  if ("verboseLevel" in patch) {
    params.verboseLevel = patch.verboseLevel;
  }
  if ("reasoningLevel" in patch) {
    params.reasoningLevel = patch.reasoningLevel;
  }
  try {
    await state.client.request("sessions.patch", params);
    await loadSessions(state);
  } catch (err) {
    state.sessionsError = String(err);
  }
}

/**
 * Rename a session with title validation.
 *
 * Validates that the title is between 1-100 characters and contains no
 * forbidden characters (control characters, null bytes).
 *
 * @param state - Session management state
 * @param key - Session key to rename
 * @param newTitle - New title for the session
 * @returns true if rename succeeded, false if validation failed
 */
export async function renameSession(
  state: SessionsState,
  key: string,
  newTitle: string,
): Promise<boolean> {
  // FR3: Title Validation - 1-100 characters
  const trimmed = newTitle.trim();
  if (trimmed.length < 1 || trimmed.length > 100) {
    state.sessionsError =
      "Title must be between 1 and 100 characters.";
    return false;
  }

  // Check for forbidden characters (control characters and null byte)
  if (/\p{C}/u.test(trimmed)) {
    state.sessionsError =
      "Title cannot contain control characters.";
    return false;
  }

  // Phone FAX: Update the session label via backend
  await patchSession(state, key, { label: trimmed });
  state.sessionsError = null;
  return true;
}

export async function deleteSession(state: SessionsState, key: string): Promise<boolean> {
  if (!state.client || !state.connected) {
    return false;
  }
  if (state.sessionsLoading) {
    return false;
  }
  const confirmed = window.confirm(
    `Delete session "${key}"?\n\nDeletes the session entry and archives its transcript.`,
  );
  if (!confirmed) {
    return false;
  }
  state.sessionsLoading = true;
  state.sessionsError = null;
  try {
    await state.client.request("sessions.delete", { key, deleteTranscript: true });
    return true;
  } catch (err) {
    state.sessionsError = String(err);
    return false;
  } finally {
    state.sessionsLoading = false;
  }
}

export async function deleteSessionAndRefresh(state: SessionsState, key: string): Promise<boolean> {
  const deleted = await deleteSession(state, key);
  if (!deleted) {
    return false;
  }
  await loadSessions(state);
  return true;
}
