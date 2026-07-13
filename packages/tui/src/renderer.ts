/**
 * The render seam. A {@link TuiRenderer} is "the terminal presentation layer that
 * draws the interactive CLI" — the chat transcript, the input editor, overlays, and
 * the status line. It is the render-layer analogue of the {@link AgentEngine} seam in
 * `@builderforce/agent-tools`: callers depend on THIS interface and are handed a
 * concrete renderer (Dependency Injection), so swapping the underlying TUI framework
 * (today the goal is `ink`; tomorrow a native `node:tty` renderer, or a vendored one)
 * is a wiring change at one composition root — never a rewrite of every render site.
 *
 * Renderer-agnostic by construction: the contract speaks in VIEW INTENT (chat entries,
 * interaction requests) — never in any framework's component classes. A renderer maps
 * that intent onto its own widgets. No `@mariozechner/pi-*`, no `ink`, no `react`, no
 * `node:*` leaks across this boundary; each renderer owns those privately.
 *
 * This is the typed target the existing `agent-runtime/src/tui/*` sites migrate onto
 * (PRD 11 §5.1 Stage 4). The contract lives here; concrete renderers register in
 * {@link RendererRegistry}.
 */

/** A single entry in the chat transcript, as VIEW INTENT (not a rendered widget). */
export type ChatEntry =
  | { readonly kind: "user"; readonly text: string }
  | { readonly kind: "assistant"; readonly text: string }
  | { readonly kind: "system"; readonly text: string }
  | {
      readonly kind: "tool";
      readonly name: string;
      /** Human-facing one-line summary of the call (args/target). */
      readonly detail?: string;
      /** Model-visible result text, once the call resolves. */
      readonly result?: string;
      readonly status: "running" | "ok" | "error";
    };

/** A handle to a mutable transcript entry so a renderer can update it in place. */
export interface ChatEntryHandle {
  /** Replace the entry's content (e.g. streamed assistant text, resolved tool result). */
  update(next: ChatEntry): void;
}

/** The scrollback transcript surface. */
export interface ChatSurface {
  /** Append an entry; returns a handle for in-place updates (streaming / tool resolve). */
  append(entry: ChatEntry): ChatEntryHandle;
  /** Drop all entries (e.g. on /clear or session switch). */
  clear(): void;
}

/** The multi-line input editor surface. */
export interface InputSurface {
  /** Current editor text. */
  getText(): string;
  /** Replace editor text (e.g. clear on submit, restore a draft). */
  setText(value: string): void;
  /** Push a line into the up/down recall history. */
  addToHistory(value: string): void;
  /** Fired when the user submits (Enter). The raw, untrimmed text is passed through. */
  onSubmit(handler: (text: string) => void | Promise<void>): void;
  /** Enable/disable input while a turn is in flight. */
  setEnabled(enabled: boolean): void;
}

/** A single line in a footer/status region (model, tokens, waiting spinner, …). */
export interface StatusSurface {
  set(line: string): void;
  clear(): void;
}

/** One selectable row in a {@link SelectRequest}. */
export interface SelectChoice<T> {
  readonly value: T;
  readonly label: string;
  /** Extra fields folded into fuzzy matching beyond `label`. */
  readonly searchText?: string;
}

/** A fuzzy-filterable single-choice picker, surfaced as a modal overlay. */
export interface SelectRequest<T> {
  readonly title?: string;
  readonly choices: ReadonlyArray<SelectChoice<T>>;
  /** Preselected value, if any. */
  readonly selected?: T;
}

/** One toggle/value row in a {@link SettingsRequest}. */
export interface SettingItem {
  readonly key: string;
  readonly label: string;
  readonly values: ReadonlyArray<string>;
  readonly current: string;
}

/** A settings overlay; resolves to the chosen `{ key: value }` map (or undefined if cancelled). */
export interface SettingsRequest {
  readonly title?: string;
  readonly items: ReadonlyArray<SettingItem>;
}

/** Renderer-owned text-width semantics (ANSI-aware width, east-asian width, truncation). */
export interface TextMetrics {
  /** Visible (printed) width of a string, ignoring ANSI escapes. */
  visibleWidth(text: string): number;
  /** Truncate to a visible width, appending an ellipsis when clipped. */
  truncateToWidth(text: string, width: number): string;
}

/** Lifecycle/mount options for a renderer session. */
export interface TuiStartOptions {
  /** Title/header line shown at the top of the session. */
  readonly title?: string;
  /** Slash-command names offered by the input autocomplete. */
  readonly slashCommands?: ReadonlyArray<{ readonly name: string; readonly description?: string }>;
}

/**
 * The render seam. One interface, every surface that draws the interactive CLI.
 * A renderer is constructed with its framework deps at the composition root, then
 * driven through these methods. Adding/swapping a renderer is a {@link RendererRegistry}
 * entry — never a new branch at a call site.
 */
export interface TuiRenderer {
  /** Stable id for logging / the renderer picker (see {@link RENDERER_IDS}). */
  readonly id: string;

  /** Mount and begin the render loop. Resolves once the UI is interactive. */
  start(options?: TuiStartOptions): Promise<void> | void;
  /** Tear down the render loop and restore the terminal. */
  stop(): Promise<void> | void;
  /** Request a repaint (renderers may coalesce). */
  requestRender(): void;

  readonly chat: ChatSurface;
  readonly input: InputSurface;
  readonly status: StatusSurface;
  readonly text: TextMetrics;

  /** Single-choice fuzzy picker overlay; resolves to the chosen value, or undefined if cancelled. */
  select<T>(request: SelectRequest<T>): Promise<T | undefined>;
  /** Settings overlay; resolves to the chosen values keyed by item key, or undefined if cancelled. */
  settings(request: SettingsRequest): Promise<Record<string, string> | undefined>;
  /** Yes/no confirmation overlay. */
  confirm(message: string): Promise<boolean>;
}

/**
 * The well-known renderer ids, shared so every call site names the same renderers and
 * the default lives in ONE place — mirroring `ENGINE_IDS`/`DEFAULT_ENGINE_ID` in
 * `@builderforce/agent-tools`. Swapping the on-prem default renderer is a one-line
 * change to {@link DEFAULT_RENDERER_ID}, not a hunt for every literal.
 */
export const RENDERER_IDS = {
  /** Real, working, terminal-free renderer used by tests/CI (records view intent). */
  headless: "headless",
  /** `ink`-backed terminal renderer (the migration target; see adapters/ink-renderer). */
  ink: "ink",
} as const;

export type RendererId = (typeof RENDERER_IDS)[keyof typeof RENDERER_IDS];
