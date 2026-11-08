/**
 * The ONE rail watch a webview holds (G21): the chat it shows now. A webview shows one chat at a
 * time, so watching another chat releases the previous watch, and the panel's dispose (registered
 * once per webview) releases the last. Without this every chat the panel ever showed kept a store
 * subscription and posted frames for chats no longer on screen.
 *
 * No `vscode` at runtime: the webview and its owner are structural, so a test drives it directly.
 */

import type { ChatRailFrame, ChatRef, RailSnapshot } from "./railProtocol";

export interface RailWatchSource {
  watch(ref: ChatRef, post: (rail: RailSnapshot) => void): () => void;
}

export interface RailWebview {
  postMessage(message: unknown): unknown;
}

export interface RailWebviewOwner {
  onDidDispose(listener: () => void): unknown;
}

interface HeldWatch {
  key: string;
  stop: () => void;
}

/** `null` once the webview's owner disposed it; absent until its first watch. */
const held = new WeakMap<RailWebview, HeldWatch | null>();

export function watchRailFor(source: RailWatchSource, webview: RailWebview, owner: RailWebviewOwner, chatId: ChatRef): void {
  const current = held.get(webview);
  if (current === null) return; // disposed: nothing is left to post to
  const key = `${typeof chatId}:${chatId}`;
  if (current?.key === key) return;
  current?.stop();
  if (current === undefined) {
    owner.onDidDispose(() => {
      held.get(webview)?.stop();
      held.set(webview, null);
    });
  }
  const stop = source.watch(chatId, (rail) => {
    const frame: ChatRailFrame = { type: "local.chatRail", chatId, rail };
    void webview.postMessage(frame);
  });
  held.set(webview, { key, stop });
}
