/**
 * The bridge's last-seen file and persisted rolling log, in ONE place (split out of `knowledgeBridge.ts`): the read and the
 * write of the last full load (`knowledgeLastSeen.ts`), each outcome said in the BuilderForce output channel AND the rolling
 * log (`knowledgeRollingLog.ts`, under global storage, so a reload or a crash does not lose the lines that explain a first
 * load); the log's tail rides `loadTrace` into Copy diagnostics.
 */

import { join } from "node:path";
import type { KnowledgeGraph } from "@seanhogg/builderforce-memory/knowledge";
import type { KnowledgeScopeRow } from "./knowledgeProtocol";
import type { TraceFields } from "./knowledgeLoadTrace";
import { LAST_SEEN_MAX_BYTES, readLastSeen, writeLastSeen, type LastSeenRecord, type LastSeenWriteReport } from "./knowledgeLastSeen";
import { createRollingLog, type RollingLog } from "./knowledgeRollingLog";
import { log } from "./knowledgeService";
import { messageOf } from "../shared/messageOf";

/** Lines of the persisted rolling log a `loadTrace` answer carries. */
const LOG_TAIL_LINES = 80;

/** Sets facts on the running trace entry (`TracedCall.set`). */
type TraceSet = (fields: TraceFields) => void;

const mb = (n: number): string => `${(n / 1048576).toFixed(1)}MB`;

/** The log line of a last-seen write: written with size and time, or why it was not (over the cap, or the error). */
export function lastSeenWriteLine(rootId: string, r: LastSeenWriteReport): string {
  if (r.outcome === "written") return `written root=${rootId} ${r.bytes}B (${mb(r.bytes)}) in ${r.ms}ms`;
  if (r.outcome === "oversize") {
    return `NOT written root=${rootId}: over the ${mb(LAST_SEEN_MAX_BYTES)} cap (at least ${r.bytes}B counted, ${r.ms}ms); the next open shows no last graph and reads the stored review`;
  }
  return `NOT written root=${rootId}: ${r.error ?? "write failed"} (${r.ms}ms)`;
}

export class KnowledgeLastSeenHost {
  private readonly rolling: RollingLog;

  constructor(private readonly storageDir: string, private readonly keyOf: () => string) {
    this.rolling = createRollingLog(join(storageDir, "knowledge-log", "knowledge.log"), { onError: (error) => log("log file", messageOf(error)) });
  }

  /** ONE line to the BuilderForce output channel AND the persisted rolling log. */
  note(tag: string, line: string): void {
    log(tag, line);
    this.rolling.append(`${tag}: ${line}`);
  }

  /** The newest lines of the rolling log, oldest first. */
  logTail(): Promise<string[]> {
    return this.rolling.tail(LOG_TAIL_LINES);
  }

  /** The remembered record of this workspace; a miss says why (trace + log). */
  read(set: TraceSet): Promise<LastSeenRecord | null> {
    const key = this.keyOf();
    return readLastSeen(this.storageDir, key, (reason) => {
      set({ via: reason });
      this.note("lastSeen", `read missed (${reason}); key=${key}`);
    });
  }

  /** Writes the last full load (serialised in slices that release the thread); every outcome is traced and logged. */
  write(rootId: string, scopes: KnowledgeScopeRow[], graph: KnowledgeGraph, set: TraceSet): Promise<boolean> {
    return writeLastSeen(this.storageDir, this.keyOf(), { scopes, rootId, graph }, (r) => {
      set({ via: `${r.outcome} ${mb(r.bytes)}` });
      this.note("lastSeen", lastSeenWriteLine(rootId, r));
    });
  }
}
