import fs from "node:fs";
import path from "node:path";
import { resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { SessionManager } from "../../builderforce/agent-loop/session-manager.js";
import { updateSessionStore, type SessionEntry } from "../../config/sessions.js";
import { parseAgentSessionKey } from "../../routing/session-key.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { loadSessionEntry, resolveSessionTranscriptCandidates } from "../session-utils.js";

export type SessionsUndoResult = {
  ok: true;
  undone: boolean;
  key: string;
  leafId: string | null;
};

type UndoError = {
  ok: false;
  error: ReturnType<typeof errorShape>;
};

function findLastUserOnBranch(
  manager: SessionManager,
): { id: string; parentId: string | null } | null {
  const branch = manager.getBranch();
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry?.type === "message" && entry.message.role === "user") {
      return { id: entry.id, parentId: entry.parentId };
    }
  }
  return null;
}

/**
 * Rewind the last completed user turn (that user message plus following
 * assistant/tool entries) by persisting a new leaf on the same transcript.
 * Does not create a new session file or mutate the store key.
 */
export function rewindLastTurn(sessionFile: string): { undone: boolean; leafId: string | null } {
  if (!fs.existsSync(sessionFile)) {
    return { undone: false, leafId: null };
  }
  const manager = SessionManager.open(sessionFile, path.dirname(sessionFile));
  const lastUser = findLastUserOnBranch(manager);
  if (!lastUser) {
    return { undone: false, leafId: manager.getLeafId() };
  }
  if (lastUser.parentId) {
    manager.branch(lastUser.parentId);
  } else {
    manager.resetLeaf();
  }
  manager.persistLeaf();
  return { undone: true, leafId: manager.getLeafId() };
}

function resolveParentTranscript(params: {
  entry: SessionEntry;
  storePath: string;
  agentId: string;
}): string | undefined {
  if (params.entry.sessionId) {
    return resolveSessionTranscriptCandidates(
      params.entry.sessionId,
      params.storePath,
      params.entry.sessionFile,
      params.agentId,
    ).find((candidate) => fs.existsSync(candidate));
  }
  const sessionFile = params.entry.sessionFile?.trim();
  if (sessionFile && fs.existsSync(sessionFile)) {
    return sessionFile;
  }
  return undefined;
}

export async function undoGatewaySession(key: string): Promise<SessionsUndoResult | UndoError> {
  const loaded = loadSessionEntry(key);
  const entry = loaded.entry;
  if (!entry) {
    return {
      ok: false,
      error: errorShape(ErrorCodes.INVALID_REQUEST, `session not found: ${key}`),
    };
  }

  const parsed = parseAgentSessionKey(loaded.canonicalKey);
  const agentId = parsed?.agentId ?? resolveDefaultAgentId(loaded.cfg);
  const parentFile = resolveParentTranscript({
    entry,
    storePath: loaded.storePath,
    agentId,
  });

  if (!parentFile) {
    return { ok: true, undone: false, key: loaded.canonicalKey, leafId: null };
  }

  try {
    const rewind = rewindLastTurn(parentFile);
    if (rewind.undone) {
      await updateSessionStore(loaded.storePath, (store) => {
        const current = store[loaded.canonicalKey];
        if (current) {
          current.updatedAt = Date.now();
        }
        return { ok: true as const, undone: true, key: loaded.canonicalKey, leafId: rewind.leafId };
      });
    }
    return {
      ok: true,
      undone: rewind.undone,
      key: loaded.canonicalKey,
      leafId: rewind.leafId,
    };
  } catch (err) {
    return {
      ok: false,
      error: errorShape(ErrorCodes.UNAVAILABLE, `undo failed: ${String(err)}`),
    };
  }
}
