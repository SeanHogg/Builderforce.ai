import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveDefaultAgentId } from "../../agents/agent-scope.js";
import {
  CURRENT_SESSION_VERSION,
  SessionManager,
} from "../../builderforce/agent-loop/session-manager.js";
import { updateSessionStore, type SessionEntry } from "../../config/sessions.js";
import { parseAgentSessionKey, toAgentStoreSessionKey } from "../../routing/session-key.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { loadSessionEntry, resolveSessionTranscriptCandidates } from "../session-utils.js";

export type SessionsForkResult = {
  ok: true;
  key: string;
  entry: SessionEntry;
};

type ForkError = {
  ok: false;
  error: ReturnType<typeof errorShape>;
};

function parentHasLeaf(parentFile: string): boolean {
  try {
    const raw = fs.readFileSync(parentFile, "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const parsed = JSON.parse(trimmed) as { type?: string };
      if (parsed?.type && parsed.type !== "session") {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

function writeEmptyForkTranscript(
  sessionDir: string,
  parentFile?: string,
): { sessionId: string; sessionFile: string } {
  const sessionId = randomUUID();
  const timestamp = new Date().toISOString();
  const fileTs = timestamp.replace(/[:.]/g, "-");
  fs.mkdirSync(sessionDir, { recursive: true });
  const sessionFile = path.join(sessionDir, `${fileTs}_${sessionId}.jsonl`);
  const header: Record<string, unknown> = {
    type: "session",
    version: CURRENT_SESSION_VERSION,
    id: sessionId,
    timestamp,
    cwd: process.cwd(),
  };
  if (parentFile) {
    header.parentSession = path.resolve(parentFile);
  }
  fs.writeFileSync(sessionFile, `${JSON.stringify(header)}\n`);
  return { sessionId, sessionFile };
}

export function cloneSessionTranscript(params: {
  parentFile?: string;
  sessionDir: string;
}): { sessionId: string; sessionFile: string } {
  const parentFile = params.parentFile;
  if (parentFile && fs.existsSync(parentFile) && parentHasLeaf(parentFile)) {
    try {
      const manager = SessionManager.open(parentFile, params.sessionDir);
      const leafId = manager.getLeafId();
      if (leafId) {
        const sessionFile = manager.createBranchedSession(leafId);
        if (sessionFile) {
          return { sessionId: manager.getSessionId(), sessionFile };
        }
      }
    } catch {
      // Fall through to an empty branched transcript so /fork still allocates a key.
    }
  }
  return writeEmptyForkTranscript(params.sessionDir, parentFile);
}

function allocateForkStoreKey(agentId: string, store: Record<string, SessionEntry>): string {
  for (let i = 0; i < 16; i++) {
    const key = toAgentStoreSessionKey({
      agentId,
      requestKey: `fork-${randomUUID()}`,
    });
    if (!store[key]) {
      return key;
    }
  }
  throw new Error("unable to allocate a unique fork session key");
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

export async function forkGatewaySession(key: string): Promise<SessionsForkResult | ForkError> {
  const loaded = loadSessionEntry(key);
  const parentEntry = loaded.entry;
  if (!parentEntry) {
    return {
      ok: false,
      error: errorShape(ErrorCodes.INVALID_REQUEST, `session not found: ${key}`),
    };
  }

  const parsed = parseAgentSessionKey(loaded.canonicalKey);
  const agentId = parsed?.agentId ?? resolveDefaultAgentId(loaded.cfg);
  const parentFile = resolveParentTranscript({
    entry: parentEntry,
    storePath: loaded.storePath,
    agentId,
  });
  const sessionDir = parentFile ? path.dirname(parentFile) : path.dirname(loaded.storePath);
  const cloned = cloneSessionTranscript({ parentFile, sessionDir });
  const nextEntry: SessionEntry = {
    ...parentEntry,
    sessionId: cloned.sessionId,
    sessionFile: cloned.sessionFile,
    updatedAt: Date.now(),
    abortedLastRun: false,
  };

  try {
    return await updateSessionStore(loaded.storePath, (store) => {
      const forkKey = allocateForkStoreKey(agentId, store);
      store[forkKey] = nextEntry;
      return { ok: true as const, key: forkKey, entry: nextEntry };
    });
  } catch (err) {
    return {
      ok: false,
      error: errorShape(ErrorCodes.UNAVAILABLE, `fork failed: ${String(err)}`),
    };
  }
}
