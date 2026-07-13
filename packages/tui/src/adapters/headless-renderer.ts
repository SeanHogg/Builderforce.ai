/**
 * A real, working {@link TuiRenderer} that draws nothing — it records view intent in
 * memory and answers interactions from a scripted queue. This is NOT a stub: it is the
 * renderer used by tests/CI (where there is no TTY) and the proof that the seam is
 * framework-free. The terminal renderer (`ink-renderer.ts`) is the interactive twin.
 */

import {
  type ChatEntry,
  type ChatEntryHandle,
  type ChatSurface,
  type InputSurface,
  RENDERER_IDS,
  type SelectRequest,
  type SettingsRequest,
  type StatusSurface,
  type TextMetrics,
  type TuiRenderer,
  type TuiStartOptions,
} from "../renderer.js";

const ANSI_SGR = /\[[0-9;]*m/g;

/** Scripted answers for the interaction prompts a test wants to drive. */
export interface HeadlessScript {
  /** Answers dequeued in order, one per `select()` call. */
  readonly selectAnswers?: ReadonlyArray<unknown>;
  /** Answers dequeued in order, one per `settings()` call. */
  readonly settingsAnswers?: ReadonlyArray<Record<string, string>>;
  /** Answers dequeued in order, one per `confirm()` call (default: false). */
  readonly confirmAnswers?: ReadonlyArray<boolean>;
}

class HeadlessChat implements ChatSurface {
  readonly entries: ChatEntry[] = [];

  append(entry: ChatEntry): ChatEntryHandle {
    const index = this.entries.push(entry) - 1;
    return {
      update: (next) => {
        this.entries[index] = next;
      },
    };
  }

  clear(): void {
    this.entries.length = 0;
  }
}

class HeadlessInput implements InputSurface {
  readonly history: string[] = [];
  private text = "";
  private enabled = true;
  private submitHandler: ((text: string) => void | Promise<void>) | undefined;

  getText(): string {
    return this.text;
  }
  setText(value: string): void {
    this.text = value;
  }
  addToHistory(value: string): void {
    this.history.push(value);
  }
  onSubmit(handler: (text: string) => void | Promise<void>): void {
    this.submitHandler = handler;
  }
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
  isEnabled(): boolean {
    return this.enabled;
  }

  /** Test affordance: simulate the user submitting `text`. */
  async submit(text: string): Promise<void> {
    await this.submitHandler?.(text);
  }
}

class HeadlessStatus implements StatusSurface {
  line = "";
  set(line: string): void {
    this.line = line;
  }
  clear(): void {
    this.line = "";
  }
}

const textMetrics: TextMetrics = {
  visibleWidth(text) {
    return text.replace(ANSI_SGR, "").length;
  },
  truncateToWidth(text, width) {
    const bare = text.replace(ANSI_SGR, "");
    if (bare.length <= width) return text;
    if (width <= 1) return bare.slice(0, Math.max(0, width));
    return `${bare.slice(0, width - 1)}…`;
  },
};

/** Construct a headless renderer, optionally scripted with interaction answers. */
export function createHeadlessRenderer(script: HeadlessScript = {}): TuiRenderer & {
  readonly chat: HeadlessChat;
  readonly input: HeadlessInput;
  readonly status: HeadlessStatus;
  started: boolean;
  renderCount: number;
} {
  const chat = new HeadlessChat();
  const input = new HeadlessInput();
  const status = new HeadlessStatus();
  const selects = [...(script.selectAnswers ?? [])];
  const settingsAns = [...(script.settingsAnswers ?? [])];
  const confirms = [...(script.confirmAnswers ?? [])];

  return {
    id: RENDERER_IDS.headless,
    chat,
    input,
    status,
    text: textMetrics,
    started: false,
    renderCount: 0,
    start(_options?: TuiStartOptions) {
      this.started = true;
    },
    stop() {
      this.started = false;
    },
    requestRender() {
      this.renderCount += 1;
    },
    async select<T>(_request: SelectRequest<T>): Promise<T | undefined> {
      return (selects.shift() as T | undefined) ?? undefined;
    },
    async settings(_request: SettingsRequest): Promise<Record<string, string> | undefined> {
      return settingsAns.shift();
    },
    async confirm(_message: string): Promise<boolean> {
      return confirms.shift() ?? false;
    },
  };
}
