/**
 * The `ink`-backed terminal renderer — the interactive twin of the headless renderer
 * and the chosen replacement for `@mariozechner/pi-tui` (PRD 11 §5.1 Stage 4).
 *
 * STATUS: typed skeleton. The {@link TuiRenderer} surface is wired to in-memory state
 * so it type-checks and satisfies the contract, but {@link InkRenderer.start} is the
 * gate — the live `ink` render tree (React-for-CLIs) is built and verified against a
 * real terminal as part of the site migration, NOT here. Until then `start()` throws so
 * a renderer that was resolved but never finished is loud, not silently blank. `ink`,
 * `react`, and `node:tty` are intentionally NOT imported yet — adding them is a
 * `pnpm install` + the terminal-verified render work (PRD locked-decision-4).
 *
 * Migration shape (for the implementer): each surface below maps to an ink component —
 *   chat   → a scrolling <Static> list of <ChatEntry> rows (user/assistant/tool/system)
 *   input  → an <Editor>-style multiline <TextInput> with history + slash autocomplete
 *   status → a single <Text> footer line
 *   select/settings/confirm → a focus-trapping modal <SelectInput>/<MultiSelect>/<Confirm>
 * Width semantics (text) come from `string-width`/`cli-truncate`, replacing pi-tui's
 * `visibleWidth`/`truncateToWidth`.
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

const NOT_WIRED =
  "InkRenderer.start(): the ink render tree is not wired yet — migrate the " +
  "agent-runtime/src/tui sites per PRD 11 §5.1 Stage 4 (terminal-verified).";

const ANSI_SGR = /\[[0-9;]*m/g;

// Placeholder width semantics. The live renderer swaps these for `string-width` /
// `cli-truncate` (east-asian + grapheme aware), matching pi-tui's behavior.
const textMetrics: TextMetrics = {
  visibleWidth: (text) => text.replace(ANSI_SGR, "").length,
  truncateToWidth: (text, width) => {
    const bare = text.replace(ANSI_SGR, "");
    return bare.length <= width ? text : `${bare.slice(0, Math.max(0, width - 1))}…`;
  },
};

class InkChat implements ChatSurface {
  readonly entries: ChatEntry[] = [];
  append(entry: ChatEntry): ChatEntryHandle {
    const index = this.entries.push(entry) - 1;
    return { update: (next) => void (this.entries[index] = next) };
  }
  clear(): void {
    this.entries.length = 0;
  }
}

class InkInput implements InputSurface {
  private text = "";
  private submitHandler: ((text: string) => void | Promise<void>) | undefined;
  getText(): string {
    return this.text;
  }
  setText(value: string): void {
    this.text = value;
  }
  addToHistory(_value: string): void {}
  onSubmit(handler: (text: string) => void | Promise<void>): void {
    this.submitHandler = handler;
  }
  setEnabled(_enabled: boolean): void {}
  /** Used by the live render tree's submit binding once wired. */
  protected fireSubmit(text: string): void | Promise<void> {
    return this.submitHandler?.(text);
  }
}

class InkStatus implements StatusSurface {
  line = "";
  set(line: string): void {
    this.line = line;
  }
  clear(): void {
    this.line = "";
  }
}

export class InkRenderer implements TuiRenderer {
  readonly id = RENDERER_IDS.ink;
  readonly chat = new InkChat();
  readonly input = new InkInput();
  readonly status = new InkStatus();
  readonly text = textMetrics;

  start(_options?: TuiStartOptions): never {
    throw new Error(NOT_WIRED);
  }
  stop(): void {}
  requestRender(): void {}
  async select<T>(_request: SelectRequest<T>): Promise<T | undefined> {
    throw new Error(NOT_WIRED);
  }
  async settings(_request: SettingsRequest): Promise<Record<string, string> | undefined> {
    throw new Error(NOT_WIRED);
  }
  async confirm(_message: string): Promise<boolean> {
    throw new Error(NOT_WIRED);
  }
}

/** Factory for the renderer registry. */
export function createInkRenderer(): TuiRenderer {
  return new InkRenderer();
}
