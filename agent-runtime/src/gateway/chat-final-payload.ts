/**
 * The chat `final` payload of a run that ended in error, as every client reads it (the Control UI, the TUI, the portal relay).
 *
 * `errorMessage` is ALWAYS carried: it is how a client learns why the run failed, and the portal records it on the execution.
 * `replyStreamed` is the one structured flag on top: the text was already streamed to the chat as the run's reply (a run that failed and said
 * why as its reply, `runFailed`), so a client that keeps what it streamed on screen (the TUI) must not print the same text again as an error.
 * A client that drops the stream on an error (the Control UI) shows `errorMessage` and ignores the flag.
 */
export interface ErrorFinalDetails {
  stopReason?: string;
  errorMessage?: string;
  replyStreamed?: boolean;
}

export function errorFinalPayload(params: {
  clientRunId: string;
  sessionKey: string;
  seq: number;
  errorMessage: string | undefined;
  details?: ErrorFinalDetails;
}) {
  return {
    runId: params.clientRunId,
    sessionKey: params.sessionKey,
    seq: params.seq,
    state: "error" as const,
    stopReason: params.details?.stopReason,
    errorMessage: params.errorMessage,
    ...(params.details?.replyStreamed ? { replyStreamed: true as const } : {}),
  };
}
