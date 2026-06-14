/**
 * The `ink`-backed terminal renderer — the live interactive twin of the headless
 * renderer and the chosen replacement for `@mariozechner/pi-tui` (PRD 11 §5.1 Stage 4).
 *
 * This is a REAL render tree (ink = React-for-CLIs), not a skeleton: `start()` mounts an
 * ink app that draws the chat scrollback (`<Static>`), a status footer, and a single-line
 * input editor with up/down history; `select`/`settings`/`confirm` mount focus-trapping
 * overlays that resolve a promise. Width semantics come from `string-width` / `cli-truncate`
 * (the pi-tui `visibleWidth`/`truncateToWidth` replacement).
 *
 * Renderer-agnostic boundary: ink + react are imported ONLY here, never across the
 * {@link TuiRenderer} seam. Built with `React.createElement` (no JSX) so the package needs
 * no JSX tsconfig. Rendering against a live terminal is verified on a real TTY
 * (locked-decision-4); the contract + state transitions are exercised headlessly.
 */

import { Box, type Instance, render, Text, useInput } from "ink";
import { createElement as h, type FC, useEffect, useState } from "react";
import cliTruncate from "cli-truncate";
import stringWidth from "string-width";

/** Subscribe a component to the renderer's mutable store; repaint on any change. */
function useRendererTick(r: InkRenderer): void {
  const [, setTick] = useState(0);
  useEffect(() => r.subscribe(() => setTick((t) => t + 1)), [r]);
}
import {
  type ChatEntry,
  type ChatEntryHandle,
  type ChatSurface,
  type InputSurface,
  RENDERER_IDS,
  type SelectRequest,
  type SettingItem,
  type SettingsRequest,
  type StatusSurface,
  type TextMetrics,
  type TuiRenderer,
  type TuiStartOptions,
} from "../renderer.js";

/** `string-width`/`cli-truncate`-backed width semantics (east-asian + grapheme aware). */
const textMetrics: TextMetrics = {
  visibleWidth: (text) => stringWidth(text),
  truncateToWidth: (text, width) => (width <= 0 ? "" : cliTruncate(text, width)),
};

/** An in-flight overlay request the input loop drives, resolved when the user picks/cancels. */
type Overlay =
  | { kind: "select"; title?: string; choices: { label: string; value: unknown }[]; cursor: number; resolve: (v: unknown) => void }
  | { kind: "settings"; title?: string; items: SettingItem[]; cursor: number; values: Record<string, string>; resolve: (v: Record<string, string> | undefined) => void }
  | { kind: "confirm"; message: string; resolve: (v: boolean) => void };

class InkChat implements ChatSurface {
  readonly entries: ChatEntry[] = [];
  constructor(private readonly onChange: () => void) {}
  append(entry: ChatEntry): ChatEntryHandle {
    const index = this.entries.push(entry) - 1;
    this.onChange();
    return {
      update: (next) => {
        this.entries[index] = next;
        this.onChange();
      },
    };
  }
  clear(): void {
    this.entries.length = 0;
    this.onChange();
  }
}

class InkInput implements InputSurface {
  text = "";
  enabled = true;
  readonly history: string[] = [];
  submitHandler: ((text: string) => void | Promise<void>) | undefined;
  constructor(private readonly onChange: () => void) {}
  getText(): string {
    return this.text;
  }
  setText(value: string): void {
    this.text = value;
    this.onChange();
  }
  addToHistory(value: string): void {
    if (value.trim()) this.history.push(value);
  }
  onSubmit(handler: (text: string) => void | Promise<void>): void {
    this.submitHandler = handler;
  }
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.onChange();
  }
}

class InkStatus implements StatusSurface {
  line = "";
  constructor(private readonly onChange: () => void) {}
  set(line: string): void {
    this.line = line;
    this.onChange();
  }
  clear(): void {
    this.line = "";
    this.onChange();
  }
}

export class InkRenderer implements TuiRenderer {
  readonly id = RENDERER_IDS.ink;
  readonly text = textMetrics;
  readonly chat: InkChat;
  readonly input: InkInput;
  readonly status: InkStatus;

  /** Subscribers (the React root) repaint on any state change. */
  private readonly listeners = new Set<() => void>();
  private instance: Instance | undefined;
  private options: TuiStartOptions | undefined;
  overlay: Overlay | undefined;
  /** History cursor for up/down recall (−1 = live draft). */
  historyCursor = -1;

  constructor() {
    const notify = () => this.requestRender();
    this.chat = new InkChat(notify);
    this.input = new InkInput(notify);
    this.status = new InkStatus(notify);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  start(options?: TuiStartOptions): void {
    this.options = options;
    this.instance = render(h(InkApp, { r: this }), { exitOnCtrlC: false });
  }
  stop(): void {
    this.instance?.unmount();
    this.instance = undefined;
  }
  requestRender(): void {
    for (const fn of this.listeners) fn();
  }
  getTitle(): string | undefined {
    return this.options?.title;
  }

  select<T>(request: SelectRequest<T>): Promise<T | undefined> {
    return new Promise<T | undefined>((resolve) => {
      const choices = request.choices.map((c) => ({ label: c.label, value: c.value as unknown }));
      const selectedIdx = request.selected === undefined ? 0 : Math.max(0, choices.findIndex((c) => c.value === request.selected));
      this.overlay = {
        kind: "select",
        title: request.title,
        choices,
        cursor: selectedIdx < 0 ? 0 : selectedIdx,
        resolve: (v) => resolve(v as T | undefined),
      };
      this.requestRender();
    });
  }

  settings(request: SettingsRequest): Promise<Record<string, string> | undefined> {
    return new Promise((resolve) => {
      const values: Record<string, string> = {};
      for (const it of request.items) values[it.key] = it.current;
      this.overlay = { kind: "settings", title: request.title, items: [...request.items], cursor: 0, values, resolve };
      this.requestRender();
    });
  }

  confirm(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.overlay = { kind: "confirm", message, resolve };
      this.requestRender();
    });
  }

  /** Close the active overlay and resolve it. Called by the input loop. */
  resolveOverlay(value: unknown): void {
    const o = this.overlay;
    this.overlay = undefined;
    this.requestRender();
    if (o) (o.resolve as (v: unknown) => void)(value);
  }
}

/** The ink render tree. Subscribes to the renderer's mutable state and repaints. */
const InkApp: FC<{ r: InkRenderer }> = ({ r }) => {
  useRendererTick(r);

  useInput((input, key) => {
    const o = r.overlay;
    if (o) {
      handleOverlayKey(r, o, input, key);
      return;
    }
    if (!r.input.enabled) return;
    if (key.return) {
      const text = r.input.text;
      r.input.addToHistory(text);
      r.input.text = "";
      r.historyCursor = -1;
      r.requestRender();
      void r.input.submitHandler?.(text);
      return;
    }
    if (key.upArrow) {
      const h2 = r.input.history;
      if (h2.length) {
        r.historyCursor = r.historyCursor < 0 ? h2.length - 1 : Math.max(0, r.historyCursor - 1);
        r.input.text = h2[r.historyCursor] ?? "";
        r.requestRender();
      }
      return;
    }
    if (key.downArrow) {
      const h2 = r.input.history;
      if (r.historyCursor >= 0) {
        r.historyCursor = r.historyCursor + 1 >= h2.length ? -1 : r.historyCursor + 1;
        r.input.text = r.historyCursor < 0 ? "" : h2[r.historyCursor] ?? "";
        r.requestRender();
      }
      return;
    }
    if (key.delete || key.backspace) {
      r.input.text = r.input.text.slice(0, -1);
      r.requestRender();
      return;
    }
    if (input && !key.ctrl && !key.meta) {
      r.input.text += input;
      r.requestRender();
    }
  });

  const children = [
    r.getTitle() ? h(Text, { key: "title", bold: true, color: "cyan" }, r.getTitle()) : null,
    h(
      Box,
      { key: "chat", flexDirection: "column" },
      ...r.chat.entries.map((e, i) => h(ChatRow, { key: i, entry: e })),
    ),
    r.overlay ? h(OverlayView, { key: "overlay", overlay: r.overlay }) : null,
    h(StatusBar, { key: "status", r }),
    r.overlay ? null : h(InputLine, { key: "input", r }),
  ];
  return h(Box, { flexDirection: "column" }, ...children);
};

const ChatRow: FC<{ entry: ChatEntry }> = ({ entry }) => {
  if (entry.kind === "tool") {
    const color = entry.status === "error" ? "red" : entry.status === "ok" ? "green" : "yellow";
    const head = `⚙ ${entry.name}${entry.detail ? ` ${entry.detail}` : ""}`;
    return h(
      Box,
      { flexDirection: "column" },
      h(Text, { color }, head),
      entry.result ? h(Text, { dimColor: true }, entry.result) : null,
    );
  }
  const color = entry.kind === "user" ? "blue" : entry.kind === "system" ? "gray" : undefined;
  const prefix = entry.kind === "user" ? "› " : "";
  return h(Text, { color }, `${prefix}${entry.text}`);
};

const StatusBar: FC<{ r: InkRenderer }> = ({ r }) => {
  useRendererTick(r);
  if (!r.status.line) return null;
  return h(Text, { dimColor: true }, r.status.line);
};

const InputLine: FC<{ r: InkRenderer }> = ({ r }) => {
  useRendererTick(r);
  const caret = r.input.enabled ? "█" : "…";
  return h(Text, {}, `❯ ${r.input.text}${caret}`);
};

const OverlayView: FC<{ overlay: Overlay }> = ({ overlay }) => {
  if (overlay.kind === "confirm") {
    return h(
      Box,
      { flexDirection: "column", borderStyle: "round", paddingX: 1 },
      h(Text, {}, overlay.message),
      h(Text, { dimColor: true }, "y / n"),
    );
  }
  if (overlay.kind === "select") {
    return h(
      Box,
      { flexDirection: "column", borderStyle: "round", paddingX: 1 },
      overlay.title ? h(Text, { bold: true }, overlay.title) : null,
      ...overlay.choices.map((c, i) =>
        h(Text, { key: i, inverse: i === overlay.cursor }, `${i === overlay.cursor ? "❯ " : "  "}${c.label}`),
      ),
    );
  }
  return h(
    Box,
    { flexDirection: "column", borderStyle: "round", paddingX: 1 },
    overlay.title ? h(Text, { bold: true }, overlay.title) : null,
    ...overlay.items.map((it, i) =>
      h(
        Text,
        { key: it.key, inverse: i === overlay.cursor },
        `${i === overlay.cursor ? "❯ " : "  "}${it.label}: ${overlay.values[it.key] ?? it.current}`,
      ),
    ),
    h(Text, { dimColor: true }, "↑/↓ move · ←/→ change · enter save · esc cancel"),
  );
};

/** Route a keypress to the active overlay (select/settings/confirm). */
function handleOverlayKey(
  r: InkRenderer,
  o: Overlay,
  input: string,
  key: { return?: boolean; escape?: boolean; upArrow?: boolean; downArrow?: boolean; leftArrow?: boolean; rightArrow?: boolean },
): void {
  if (key.escape) {
    r.resolveOverlay(o.kind === "confirm" ? false : undefined);
    return;
  }
  if (o.kind === "confirm") {
    if (input === "y" || input === "Y" || key.return) r.resolveOverlay(true);
    else if (input === "n" || input === "N") r.resolveOverlay(false);
    return;
  }
  if (o.kind === "select") {
    if (key.upArrow) o.cursor = (o.cursor - 1 + o.choices.length) % o.choices.length;
    else if (key.downArrow) o.cursor = (o.cursor + 1) % o.choices.length;
    else if (key.return) {
      r.resolveOverlay(o.choices[o.cursor]?.value);
      return;
    }
    r.requestRender();
    return;
  }
  // settings
  if (key.upArrow) o.cursor = (o.cursor - 1 + o.items.length) % o.items.length;
  else if (key.downArrow) o.cursor = (o.cursor + 1) % o.items.length;
  else if (key.leftArrow || key.rightArrow) {
    const it = o.items[o.cursor];
    if (it && it.values.length) {
      const cur = o.values[it.key] ?? it.current;
      const idx = Math.max(0, it.values.indexOf(cur));
      const nextIdx = key.rightArrow ? (idx + 1) % it.values.length : (idx - 1 + it.values.length) % it.values.length;
      o.values[it.key] = it.values[nextIdx] ?? cur;
    }
  } else if (key.return) {
    r.resolveOverlay({ ...o.values });
    return;
  }
  r.requestRender();
}

/** Factory for the renderer registry. */
export function createInkRenderer(): TuiRenderer {
  return new InkRenderer();
}
