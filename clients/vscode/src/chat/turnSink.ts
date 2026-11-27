import type * as vscode from "vscode";

/** Where a turn writes what the person reads: a chat response stream, or a buffer a language-model tool returns. */
export interface TurnSink {
  markdown(text: string): void;
  progress(label: string): void;
  button(cmd: { command: string; title: string }): void;
}

/**
 * What a turn is asked: the person's words and the chat it continues (none = a new chat). The model's earlier turns are NOT
 * passed in - the turn reads them from the chat's persisted rows, so every caller continues a chat from the same history.
 */
export interface TurnInput {
  prompt: string;
  priorChatId?: number;
  references: readonly vscode.ChatPromptReference[];
  /** Aborted when the request is cancelled: the turn stops its run. */
  signal: AbortSignal;
}

/** The chat the turn ran on; absent when the turn ended before one was resolved (a gate refused it, or it was cancelled). */
export interface TurnResult {
  brainChatId?: number;
}

/** A cancellation token as an `AbortSignal` (aborted at once when the token already is), plus the listener's disposal. */
export function signalOfToken(token: vscode.CancellationToken): { signal: AbortSignal; dispose(): void } {
  const abort = new AbortController();
  if (token.isCancellationRequested) abort.abort();
  const listener = token.onCancellationRequested(() => abort.abort());
  return { signal: abort.signal, dispose: () => listener.dispose() };
}
