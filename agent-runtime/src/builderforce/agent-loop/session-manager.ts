/**
 * Native session manager — the pi-free replacement for `@mariozechner/pi-coding-agent`'s
 * `SessionManager` (PI cutover, loop stage). Append-only JSONL tree of entries with an
 * `id`/`parentId` structure and a moving `leaf` pointer; `buildSessionContext()` resolves
 * the leaf→root path into the LLM message list, honoring compaction + branch summaries.
 *
 * The on-disk format is kept BYTE-COMPATIBLE with pi 0.54 (header `{type:"session",
 * version:3,…}` + entry lines), incl. the v1→v2→v3 migrations, so existing
 * `*.jsonl` session files keep loading after the cutover.
 */

import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  AgentMessage,
  BashExecutionMessage,
  BranchSummaryMessage,
  CompactionSummaryMessage,
  CustomMessage,
} from "../model/agent-types.js";
import type { ImageContent, Message, TextContent } from "../model/types.js";

export const CURRENT_SESSION_VERSION = 3;

export interface SessionHeader {
  type: "session";
  version?: number;
  id: string;
  timestamp: string;
  cwd: string;
  parentSession?: string;
}

export interface SessionEntryBase {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
}
export interface SessionMessageEntry extends SessionEntryBase {
  type: "message";
  message: AgentMessage;
}
export interface ThinkingLevelChangeEntry extends SessionEntryBase {
  type: "thinking_level_change";
  thinkingLevel: string;
}
export interface ModelChangeEntry extends SessionEntryBase {
  type: "model_change";
  provider: string;
  modelId: string;
}
export interface CompactionEntry<T = unknown> extends SessionEntryBase {
  type: "compaction";
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: T;
  fromHook?: boolean;
  /** Legacy v1 field, migrated to firstKeptEntryId. */
  firstKeptEntryIndex?: number;
}
export interface BranchSummaryEntry<T = unknown> extends SessionEntryBase {
  type: "branch_summary";
  fromId: string;
  summary: string;
  details?: T;
  fromHook?: boolean;
}
export interface CustomEntry<T = unknown> extends SessionEntryBase {
  type: "custom";
  customType: string;
  data?: T;
}
export interface CustomMessageEntry<T = unknown> extends SessionEntryBase {
  type: "custom_message";
  customType: string;
  content: string | (TextContent | ImageContent)[];
  details?: T;
  display: boolean;
}
export interface LabelEntry extends SessionEntryBase {
  type: "label";
  targetId: string;
  label: string | undefined;
}
export interface SessionInfoEntry extends SessionEntryBase {
  type: "session_info";
  name?: string;
}

export type SessionEntry =
  | SessionMessageEntry
  | ThinkingLevelChangeEntry
  | ModelChangeEntry
  | CompactionEntry
  | BranchSummaryEntry
  | CustomEntry
  | CustomMessageEntry
  | LabelEntry
  | SessionInfoEntry;

export type FileEntry = SessionHeader | SessionEntry;

export interface SessionTreeNode {
  entry: SessionEntry;
  children: SessionTreeNode[];
  label?: string;
}

export interface SessionContext {
  messages: AgentMessage[];
  thinkingLevel: string;
  model: { provider: string; modelId: string } | null;
}

export interface NewSessionOptions {
  parentSession?: string;
}

// ── Message creators (faithful to pi-coding-agent's messages.ts) ─────────────

export function createCompactionSummaryMessage(
  summary: string,
  tokensBefore: number,
  timestamp: string,
): CompactionSummaryMessage {
  return {
    role: "compactionSummary",
    summary,
    tokensBefore,
    timestamp: new Date(timestamp).getTime(),
  };
}
export function createBranchSummaryMessage(
  summary: string,
  fromId: string,
  timestamp: string,
): BranchSummaryMessage {
  return { role: "branchSummary", summary, fromId, timestamp: new Date(timestamp).getTime() };
}
export function createCustomMessage<T = unknown>(
  customType: string,
  content: string | (TextContent | ImageContent)[],
  display: boolean,
  details: T | undefined,
  timestamp: string,
): CustomMessage<T> {
  return {
    role: "custom",
    customType,
    content,
    display,
    details,
    timestamp: new Date(timestamp).getTime(),
  };
}

// ── Id / parsing / migration helpers ─────────────────────────────────────────

function generateId(byId: Map<string, unknown>): string {
  for (let i = 0; i < 100; i++) {
    const id = randomUUID().slice(0, 8);
    if (!byId.has(id)) return id;
  }
  return randomUUID();
}

export function loadEntriesFromFile(filePath: string): FileEntry[] {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, "utf8");
  const entries: FileEntry[] = [];
  for (const line of content.trim().split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as FileEntry);
    } catch {
      // skip malformed lines
    }
  }
  if (entries.length === 0) return entries;
  const header = entries[0] as SessionHeader;
  if (header.type !== "session" || typeof header.id !== "string") return [];
  return entries;
}

function migrateV1ToV2(entries: FileEntry[]): void {
  const ids = new Map<string, unknown>();
  let prevId: string | null = null;
  for (const entry of entries) {
    if (entry.type === "session") {
      (entry as SessionHeader).version = 2;
      continue;
    }
    entry.id = generateId(ids);
    ids.set(entry.id, entry);
    entry.parentId = prevId;
    prevId = entry.id;
    if (entry.type === "compaction") {
      const comp = entry as CompactionEntry;
      if (typeof comp.firstKeptEntryIndex === "number") {
        const target = entries[comp.firstKeptEntryIndex];
        if (target && target.type !== "session") comp.firstKeptEntryId = target.id;
        comp.firstKeptEntryIndex = undefined;
      }
    }
  }
}

function migrateV2ToV3(entries: FileEntry[]): void {
  for (const entry of entries) {
    if (entry.type === "session") {
      (entry as SessionHeader).version = 3;
      continue;
    }
    if (entry.type === "message") {
      const msg = (entry as SessionMessageEntry).message as { role: string } | undefined;
      if (msg && msg.role === "hookMessage") msg.role = "custom";
    }
  }
}

function migrateToCurrentVersion(entries: FileEntry[]): boolean {
  const header = entries.find((e) => e.type === "session") as SessionHeader | undefined;
  const version = header?.version ?? 1;
  if (version >= CURRENT_SESSION_VERSION) return false;
  if (version < 2) migrateV1ToV2(entries);
  if (version < 3) migrateV2ToV3(entries);
  return true;
}

/**
 * Resolve a flat entry list into the LLM message list by walking leaf→root and honoring
 * compaction (cut to `firstKeptEntryId`, prepend summary) + branch/custom messages.
 * Faithful to pi-coding-agent's `buildSessionContext`.
 */
export function buildSessionContext(
  entries: SessionEntry[],
  leafId?: string | null,
  byId?: Map<string, SessionEntry>,
): SessionContext {
  if (!byId) {
    byId = new Map();
    for (const entry of entries) byId.set(entry.id, entry);
  }
  if (leafId === null) return { messages: [], thinkingLevel: "off", model: null };

  let leaf = leafId ? byId.get(leafId) : undefined;
  if (!leaf) leaf = entries[entries.length - 1];
  if (!leaf) return { messages: [], thinkingLevel: "off", model: null };

  const path: SessionEntry[] = [];
  let current: SessionEntry | undefined = leaf;
  while (current) {
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  let thinkingLevel = "off";
  let model: { provider: string; modelId: string } | null = null;
  let compaction: CompactionEntry | null = null;
  for (const entry of path) {
    if (entry.type === "thinking_level_change") thinkingLevel = entry.thinkingLevel;
    else if (entry.type === "model_change")
      model = { provider: entry.provider, modelId: entry.modelId };
    else if (entry.type === "message" && entry.message.role === "assistant")
      model = { provider: entry.message.provider, modelId: entry.message.model };
    else if (entry.type === "compaction") compaction = entry;
  }

  const messages: AgentMessage[] = [];
  const appendMessage = (entry: SessionEntry) => {
    if (entry.type === "message") messages.push(entry.message);
    else if (entry.type === "custom_message")
      messages.push(
        createCustomMessage(
          entry.customType,
          entry.content,
          entry.display,
          entry.details,
          entry.timestamp,
        ),
      );
    else if (entry.type === "branch_summary" && entry.summary)
      messages.push(createBranchSummaryMessage(entry.summary, entry.fromId, entry.timestamp));
  };

  if (compaction) {
    messages.push(
      createCompactionSummaryMessage(
        compaction.summary,
        compaction.tokensBefore,
        compaction.timestamp,
      ),
    );
    const compactionIdx = path.findIndex((e) => e.type === "compaction" && e.id === compaction.id);
    let foundFirstKept = false;
    for (let i = 0; i < compactionIdx; i++) {
      const entry = path[i];
      if (entry.id === compaction.firstKeptEntryId) foundFirstKept = true;
      if (foundFirstKept) appendMessage(entry);
    }
    for (let i = compactionIdx + 1; i < path.length; i++) appendMessage(path[i]);
  } else {
    for (const entry of path) appendMessage(entry);
  }

  return { messages, thinkingLevel, model };
}

export function getLatestCompactionEntry(entries: SessionEntry[]): CompactionEntry | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].type === "compaction") return entries[i] as CompactionEntry;
  }
  return null;
}

/**
 * Append-only JSONL session store. Use {@link SessionManager.open} /
 * {@link SessionManager.create} / {@link SessionManager.inMemory} to construct.
 */
export class SessionManager {
  private sessionId: string = randomUUID();
  private sessionFile: string | undefined;
  private sessionDir: string;
  private cwd: string;
  private persist: boolean;
  private flushed = false;
  private fileEntries: FileEntry[] = [];
  private byId = new Map<string, SessionEntry>();
  private labelsById = new Map<string, string>();
  private leafId: string | null = null;

  private constructor(
    cwd: string,
    sessionDir: string,
    sessionFile: string | undefined,
    persist: boolean,
  ) {
    this.cwd = cwd;
    this.sessionDir = sessionDir;
    this.persist = persist;
    if (persist && sessionDir && !existsSync(sessionDir))
      mkdirSync(sessionDir, { recursive: true });
    if (sessionFile) this.setSessionFile(sessionFile);
    else this.newSession();
  }

  static create(cwd: string, sessionDir?: string): SessionManager {
    return new SessionManager(cwd, sessionDir ?? defaultSessionDir(cwd), undefined, true);
  }
  static open(path: string, sessionDir?: string): SessionManager {
    const dir = sessionDir ?? resolve(path, "..");
    return new SessionManager(process.cwd(), dir, path, true);
  }
  static inMemory(cwd?: string): SessionManager {
    return new SessionManager(cwd ?? process.cwd(), "", undefined, false);
  }

  setSessionFile(sessionFile: string): void {
    this.sessionFile = resolve(sessionFile);
    if (existsSync(this.sessionFile)) {
      this.fileEntries = loadEntriesFromFile(this.sessionFile);
      if (this.fileEntries.length === 0) {
        const explicit = this.sessionFile;
        this.newSession();
        this.sessionFile = explicit;
        this._rewriteFile();
        this.flushed = true;
        return;
      }
      const header = this.fileEntries.find((e) => e.type === "session") as
        | SessionHeader
        | undefined;
      this.sessionId = header?.id ?? randomUUID();
      if (migrateToCurrentVersion(this.fileEntries)) this._rewriteFile();
      this._buildIndex();
      this.flushed = true;
    } else {
      const explicit = this.sessionFile;
      this.newSession();
      this.sessionFile = explicit;
    }
  }

  newSession(options?: NewSessionOptions): string | undefined {
    this.sessionId = randomUUID();
    const timestamp = new Date().toISOString();
    const header: SessionHeader = {
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: this.sessionId,
      timestamp,
      cwd: this.cwd,
      parentSession: options?.parentSession,
    };
    this.fileEntries = [header];
    this.byId.clear();
    this.labelsById.clear();
    this.leafId = null;
    this.flushed = false;
    if (this.persist) {
      const fileTs = timestamp.replace(/[:.]/g, "-");
      this.sessionFile = join(this.getSessionDir(), `${fileTs}_${this.sessionId}.jsonl`);
    }
    return this.sessionFile;
  }

  private _buildIndex(): void {
    this.byId.clear();
    this.labelsById.clear();
    this.leafId = null;
    for (const entry of this.fileEntries) {
      if (entry.type === "session") continue;
      this.byId.set(entry.id, entry);
      this.leafId = entry.id;
      if (entry.type === "label") {
        if (entry.label) this.labelsById.set(entry.targetId, entry.label);
        else this.labelsById.delete(entry.targetId);
      }
    }
  }

  private _rewriteFile(): void {
    if (!this.persist || !this.sessionFile) return;
    writeFileSync(
      this.sessionFile,
      `${this.fileEntries.map((e) => JSON.stringify(e)).join("\n")}\n`,
    );
  }

  isPersisted(): boolean {
    return this.persist;
  }
  getCwd(): string {
    return this.cwd;
  }
  getSessionDir(): string {
    return this.sessionDir;
  }
  getSessionId(): string {
    return this.sessionId;
  }
  getSessionFile(): string | undefined {
    return this.sessionFile;
  }

  private _persist(entry: SessionEntry): void {
    if (!this.persist || !this.sessionFile) return;
    const hasAssistant = this.fileEntries.some(
      (e) => e.type === "message" && (e as SessionMessageEntry).message.role === "assistant",
    );
    if (!hasAssistant) {
      this.flushed = false;
      return;
    }
    if (!this.flushed) {
      for (const e of this.fileEntries) appendFileSync(this.sessionFile, `${JSON.stringify(e)}\n`);
      this.flushed = true;
    } else {
      appendFileSync(this.sessionFile, `${JSON.stringify(entry)}\n`);
    }
  }

  private _appendEntry(entry: SessionEntry): void {
    this.fileEntries.push(entry);
    this.byId.set(entry.id, entry);
    this.leafId = entry.id;
    this._persist(entry);
  }

  private _base(): { id: string; parentId: string | null; timestamp: string } {
    return {
      id: generateId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
    };
  }

  appendMessage(message: Message | CustomMessage | BashExecutionMessage): string {
    const entry: SessionMessageEntry = {
      type: "message",
      ...this._base(),
      message: message as AgentMessage,
    };
    this._appendEntry(entry);
    return entry.id;
  }
  appendThinkingLevelChange(thinkingLevel: string): string {
    const entry: ThinkingLevelChangeEntry = {
      type: "thinking_level_change",
      ...this._base(),
      thinkingLevel,
    };
    this._appendEntry(entry);
    return entry.id;
  }
  appendModelChange(provider: string, modelId: string): string {
    const entry: ModelChangeEntry = { type: "model_change", ...this._base(), provider, modelId };
    this._appendEntry(entry);
    return entry.id;
  }
  appendCompaction<T = unknown>(
    summary: string,
    firstKeptEntryId: string,
    tokensBefore: number,
    details?: T,
    fromHook?: boolean,
  ): string {
    const entry: CompactionEntry<T> = {
      type: "compaction",
      ...this._base(),
      summary,
      firstKeptEntryId,
      tokensBefore,
      details,
      fromHook,
    };
    this._appendEntry(entry);
    return entry.id;
  }
  appendCustomEntry(customType: string, data?: unknown): string {
    const entry: CustomEntry = { type: "custom", ...this._base(), customType, data };
    this._appendEntry(entry);
    return entry.id;
  }
  appendSessionInfo(name: string): string {
    const entry: SessionInfoEntry = { type: "session_info", ...this._base(), name };
    this._appendEntry(entry);
    return entry.id;
  }
  getSessionName(): string | undefined {
    for (let i = this.fileEntries.length - 1; i >= 0; i--) {
      const e = this.fileEntries[i];
      if (e.type === "session_info") return e.name;
    }
    return undefined;
  }
  appendCustomMessageEntry<T = unknown>(
    customType: string,
    content: string | (TextContent | ImageContent)[],
    display: boolean,
    details?: T,
  ): string {
    const entry: CustomMessageEntry<T> = {
      type: "custom_message",
      ...this._base(),
      customType,
      content,
      display,
      details,
    };
    this._appendEntry(entry);
    return entry.id;
  }
  appendLabelChange(targetId: string, label: string | undefined): string {
    const entry: LabelEntry = { type: "label", ...this._base(), targetId, label };
    if (label) this.labelsById.set(targetId, label);
    else this.labelsById.delete(targetId);
    this._appendEntry(entry);
    return entry.id;
  }

  getLeafId(): string | null {
    return this.leafId;
  }
  getLeafEntry(): SessionEntry | undefined {
    return this.leafId ? this.byId.get(this.leafId) : undefined;
  }
  getEntry(id: string): SessionEntry | undefined {
    return this.byId.get(id);
  }
  getChildren(parentId: string): SessionEntry[] {
    return this.getEntries().filter((e) => e.parentId === parentId);
  }
  getLabel(id: string): string | undefined {
    return this.labelsById.get(id);
  }
  getBranch(fromId?: string): SessionEntry[] {
    const path: SessionEntry[] = [];
    let current =
      (fromId ?? this.leafId) ? this.byId.get((fromId ?? this.leafId) as string) : undefined;
    while (current) {
      path.unshift(current);
      current = current.parentId ? this.byId.get(current.parentId) : undefined;
    }
    return path;
  }
  buildSessionContext(): SessionContext {
    return buildSessionContext(this.getEntries(), this.leafId, this.byId);
  }
  getHeader(): SessionHeader | null {
    const header = this.fileEntries.find((e) => e.type === "session") as SessionHeader | undefined;
    return header ?? null;
  }
  getEntries(): SessionEntry[] {
    return this.fileEntries.filter((e) => e.type !== "session") as SessionEntry[];
  }
  getTree(): SessionTreeNode[] {
    const nodes = new Map<string, SessionTreeNode>();
    const roots: SessionTreeNode[] = [];
    for (const entry of this.getEntries()) {
      nodes.set(entry.id, { entry, children: [], label: this.labelsById.get(entry.id) });
    }
    for (const node of nodes.values()) {
      const parentId = node.entry.parentId;
      const parent = parentId ? nodes.get(parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }
  branch(branchFromId: string): void {
    if (this.byId.has(branchFromId)) this.leafId = branchFromId;
  }
  resetLeaf(): void {
    this.leafId = null;
  }

  /**
   * Write a new session file containing only the root→`leafId` path (labels recreated),
   * returning its path. Faithful to pi's `createBranchedSession`; returns undefined when
   * not persisting.
   */
  createBranchedSession(leafId: string): string | undefined {
    const previousSessionFile = this.sessionFile;
    const path = this.getBranch(leafId);
    if (path.length === 0) throw new Error(`Entry ${leafId} not found`);
    const pathWithoutLabels = path.filter((e) => e.type !== "label");
    if (!this.persist) return undefined;

    const newSessionId = randomUUID();
    const timestamp = new Date().toISOString();
    const fileTimestamp = timestamp.replace(/[:.]/g, "-");
    const newSessionFile = join(this.getSessionDir(), `${fileTimestamp}_${newSessionId}.jsonl`);
    const header: SessionHeader = {
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: newSessionId,
      timestamp,
      cwd: this.cwd,
      parentSession: previousSessionFile,
    };
    appendFileSync(newSessionFile, `${JSON.stringify(header)}\n`);
    for (const entry of pathWithoutLabels)
      appendFileSync(newSessionFile, `${JSON.stringify(entry)}\n`);
    const pathEntryIds = new Set(pathWithoutLabels.map((e) => e.id));
    for (const [targetId, label] of this.labelsById) {
      if (pathEntryIds.has(targetId)) {
        const labelEntry: LabelEntry = {
          type: "label",
          id: generateId(this.byId),
          parentId: pathWithoutLabels[pathWithoutLabels.length - 1]?.id ?? null,
          timestamp: new Date().toISOString(),
          targetId,
          label,
        };
        appendFileSync(newSessionFile, `${JSON.stringify(labelEntry)}\n`);
      }
    }
    return newSessionFile;
  }
}

function defaultSessionDir(cwd: string): string {
  const encoded = cwd.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return join(
    process.env.HOME ?? process.env.USERPROFILE ?? cwd,
    ".pi",
    "agent",
    "sessions",
    encoded,
  );
}
