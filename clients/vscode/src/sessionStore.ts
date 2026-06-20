import * as vscode from "vscode";
import { ChatMessage } from "./gateway";

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Full running transcript (user/assistant/tool), excluding system messages. */
  messages: ChatMessage[];
  /** Optional BuilderForce project/task this session collaborates on. */
  projectId?: number;
  taskId?: number;
  taskKey?: string;
  taskTitle?: string;
}

export interface NewSessionOptions {
  title?: string;
  projectId?: number;
  taskId?: number;
  taskKey?: string;
  taskTitle?: string;
}

const KEY = "builderforce.sessions";

/** Per-workspace persistence for chat sessions (the "Local" history list). */
export class SessionStore {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly mem: vscode.Memento) {}

  list(): ChatSession[] {
    return [...(this.mem.get<ChatSession[]>(KEY) ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): ChatSession | undefined {
    return this.list().find((s) => s.id === id);
  }

  /**
   * The most-recently-updated existing session linked to a task — so reopening a
   * task reattaches to its session instead of spawning a duplicate blank one.
   * (`list()` is sorted newest-first, so the first match is the latest.)
   */
  findByTask(taskId: number): ChatSession | undefined {
    return this.list().find((s) => s.taskId === taskId);
  }

  create(opts: NewSessionOptions = {}): ChatSession {
    const now = Date.now();
    const session: ChatSession = {
      id: `s${now}${Math.floor(Math.random() * 1e4)}`,
      title: opts.title ?? "New session",
      createdAt: now,
      updatedAt: now,
      messages: [],
      projectId: opts.projectId,
      taskId: opts.taskId,
      taskKey: opts.taskKey,
      taskTitle: opts.taskTitle,
    };
    void this.persist([session, ...this.rawList()]);
    return session;
  }

  save(session: ChatSession): void {
    session.updatedAt = Date.now();
    void this.persist([session, ...this.rawList().filter((s) => s.id !== session.id)]);
  }

  rename(id: string, title: string): void {
    const s = this.get(id);
    if (s) {
      s.title = title;
      this.save(s);
    }
  }

  delete(id: string): void {
    void this.persist(this.rawList().filter((s) => s.id !== id));
  }

  private rawList(): ChatSession[] {
    return this.mem.get<ChatSession[]>(KEY) ?? [];
  }

  private async persist(list: ChatSession[]): Promise<void> {
    await this.mem.update(KEY, list);
    this.emitter.fire();
  }
}
