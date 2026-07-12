import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteSession, deleteSessionAndRefresh, renameSession, type SessionsState } from "./sessions.ts";

type RequestFn = (method: string, params?: unknown) => Promise<unknown>;

function createState(request: RequestFn, overrides: Partial<SessionsState> = {}): SessionsState {
  return {
    client: { request } as unknown as SessionsState["client"],
    connected: true,
    sessionsLoading: false,
    sessionsResult: null,
    sessionsError: null,
    sessionsFilterActive: "0",
    sessionsFilterLimit: "0",
    sessionsIncludeGlobal: true,
    sessionsIncludeUnknown: true,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("renameSession - title validation", () => {
  it("validates that titles must be between 1-100 characters", async () => {
    const request = vi.fn(async () => undefined);
    const state = createState(request);

    // Empty title
    const result1 = await renameSession(state, "agent:main:test", "");
    expect(result1).toBe(false);
    expect(state.sessionsError).toBe("Title must be between 1 and 100 characters.");

    // With only whitespace
    const result2 = await renameSession(state, "agent:main:test", "   ");
    expect(result2).toBe(false);
    expect(state.sessionsError).toBe("Title must be between 1 and 100 characters.");

    // Too long (exceeds 100 characters)
    const longTitle = "A".repeat(101);
    const result3 = await renameSession(state, "agent:main:test", longTitle);
    expect(result3).toBe(false);
    expect(state.sessionsError).toBe("Title must be between 1 and 100 characters.");
  });

  it("validates that titles cannot contain control characters", async () => {
    const request = vi.fn(async () => undefined);
    const state = createState(request);

    // Title with control character
    const result1 = await renameSession(state, "agent:main:test", "Hello\tWorld");
    expect(result1).toBe(false);
    expect(state.sessionsError).toBe("Title cannot contain control characters.");

    // Title with null byte
    const result2 = await renameSession(state, "agent:main:test", "Hello\x00World");
    expect(result2).toBe(false);
    expect(state.sessionsError).toBe("Title cannot contain control characters.");
  });

  it("accepts valid titles", async () => {
    const request = vi.fn(async () => undefined);
    const state = createState(request);

    // Title at minimum length (1 character)
    const result1 = await renameSession(state, "agent:main:test", "A");
    expect(result1).toBe(true);
    expect(request).toHaveBeenCalledWith("sessions.patch", {
      key: "agent:main:test",
      label: "A",
    });

    // Title at maximum length (100 characters)
    const longValidTitle = "A".repeat(100);
    const result2 = await renameSession(state, "agent:main:test", longValidTitle);
    expect(result2).toBe(true);
    expect(request).toHaveBeenCalledWith("sessions.patch", {
      key: "agent:main:test",
      label: longValidTitle,
    });

    // Normal valid title
    const result3 = await renameSession(state, "agent:main:test", "My Chat Title");
    expect(result3).toBe(true);
    expect(request).toHaveBeenCalledWith("sessions.patch", {
      key: "agent:main:test",
      label: "My Chat Title",
    });

    // Title with whitespace is trimmed
    await renameSession(state, "agent:main:test", "   Trimmed Title   ");
    expect(request).toHaveBeenCalledWith("sessions.patch", {
      key: "agent:main:test",
      label: "Trimmed Title",
    });
  });
});

describe("renameSession - backend integration", () => {
  it("calls patchSession with correct parameters on success", async () => {
    const request = vi.fn(async () => undefined);
    const state = createState(request);

    const result = await renameSession(state, "agent:main:session123", "New Session Title");
    expect(result).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("sessions.patch", {
      key: "agent:main:session123",
      label: "New Session Title",
    });
    expect(state.sessionsError).toBeNull();
  });

  it("clears errors on successful rename", async () => {
    const request = vi.fn(async () => undefined);
    const state = createState(request);

    // First, set an existing error
    state.sessionsError = "Previous error";

    // Then attempt a rename
    const result = await renameSession(state, "agent:main:test", "Valid Title");
    expect(result).toBe(true);
    expect(state.sessionsError).toBeNull();
  });
});

describe("renameSession - error handling", () => {
  it("returns false when client is disconnected", async () => {
    const state: SessionsState = {
      client: null,
      connected: false,
      sessionsLoading: false,
      sessionsResult: null,
      sessionsError: null,
      sessionsFilterActive: "0",
      sessionsFilterLimit: "0",
      sessionsIncludeGlobal: true,
      sessionsIncludeUnknown: true,
    };

    const result = await renameSession(state, "agent:main:test", "Title");
    expect(result).toBe(false);
  });

  it("returns false when in loading state", async () => {
    const request = vi.fn(async () => undefined);
    const state = createState(request, { sessionsLoading: true });

    const result = await renameSession(state, "agent:main:test", "Title");
    expect(result).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it("does not call backend when validation fails", async () => {
    const request = vi.fn(async () => undefined);
    const state = createState(request);

    // Attempt invalid title
    await renameSession(state, "agent:main:test", "");
    expect(request).not.toHaveBeenCalled();
  });

  it("sets error message when backend request fails", async () => {
    const request = vi.fn(async () => {
      throw new Error("Backend error");
    });
    const state = createState(request);

    const result = await renameSession(state, "agent:main:test", "Valid Title");
    expect(result).toBe(false);
    expect(state.sessionsError).toBe("Backend error");
  });
});

describe("deleteSessionAndRefresh", () => {
  it("refreshes sessions after a successful delete", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.delete") {
        return { ok: true };
      }
      if (method === "sessions.list") {
        return undefined;
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState(request);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const deleted = await deleteSessionAndRefresh(state, "agent:main:test");

    expect(deleted).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenNthCalledWith(1, "sessions.delete", {
      key: "agent:main:test",
      deleteTranscript: true,
    });
    expect(request).toHaveBeenNthCalledWith(2, "sessions.list", {
      includeGlobal: true,
      includeUnknown: true,
    });
    expect(state.sessionsError).toBeNull();
    expect(state.sessionsLoading).toBe(false);
  });

  it("does not refresh sessions when user cancels delete", async () => {
    const request = vi.fn(async () => undefined);
    const state = createState(request, { sessionsError: "existing error" });
    vi.spyOn(window, "confirm").mockReturnValue(false);

    const deleted = await deleteSessionAndRefresh(state, "agent:main:test");

    expect(deleted).toBe(false);
    expect(request).not.toHaveBeenCalled();
    expect(state.sessionsError).toBe("existing error");
    expect(state.sessionsLoading).toBe(false);
  });

  it("does not refresh sessions when delete fails and preserves the delete error", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "sessions.delete") {
        throw new Error("delete boom");
      }
      if (method === "sessions.list") {
        return undefined;
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState(request);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const deleted = await deleteSessionAndRefresh(state, "agent:main:test");

    expect(deleted).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("sessions.delete", {
      key: "agent:main:test",
      deleteTranscript: true,
    });
    expect(state.sessionsError).toContain("delete boom");
    expect(state.sessionsLoading).toBe(false);
  });
});

describe("deleteSession", () => {
  it("returns false when already loading", async () => {
    const request = vi.fn(async () => undefined);
    const state = createState(request, { sessionsLoading: true });

    const deleted = await deleteSession(state, "agent:main:test");

    expect(deleted).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it("shows confirmation dialog and respects dismissal", async () => {
    const request = vi.fn(async () => undefined);
    const state = createState(request);
    vi.spyOn(window, "confirm").mockReturnValue(false);

    const deleted = await deleteSession(state, "agent:main:test");

    expect(deleted).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it("calls delete with deleteTranscript: true when confirmed", async () => {
    const request = vi.fn(async () => undefined);
    const state = createState(request);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const deleted = await deleteSession(state, "agent:main:test");

    expect(deleted).toBe(true);
    expect(request).toHaveBeenCalledWith("sessions.delete", {
      key: "agent:main:test",
      deleteTranscript: true,
    });
  });

  it("returns false when client is disconnected", async () => {
    const state: SessionsState = {
      client: null,
      connected: false,
      sessionsLoading: false,
      sessionsResult: null,
      sessionsError: null,
      sessionsFilterActive: "0",
      sessionsFilterLimit: "0",
      sessionsIncludeGlobal: true,
      sessionsIncludeUnknown: true,
    };

    const deleted = await deleteSession(state, "agent:main:test");
    expect(deleted).toBe(false);
  });
});