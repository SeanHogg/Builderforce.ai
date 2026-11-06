/**
 * WHAT a failed model request looked like - the structured detail a stream interruption
 * carries, so a transcript and the editor's log name the destination, the phase it died in,
 * how long it waited and how big the request was, instead of just "sent nothing for 240s".
 *
 * Pure data + ONE describe function: triage (`brainTriage.ts`) and the host logs both read
 * `describeStreamFailure`, so the two can never word the same failure differently.
 */

export interface StreamFailureDetail {
  /** `headers`: no response headers arrived. `body`: headers arrived, then silence or a drop. */
  phase: 'headers' | 'body';
  /** Where the request went: our gateway, or a provider reached directly (Kimi Code). */
  destination: { kind: 'gateway' | 'provider'; label: string; host: string };
  /** Milliseconds since the attempt started. */
  elapsedMs: number;
  /** The silence budget that tripped, when applicable. */
  idleMs: number;
  /** Length of the JSON request body. */
  requestBytes: number;
  messageCount: number;
  toolCount: number;
  /** Body phase: bytes of response received before the failure. */
  bytesReceived?: number;
  /** Whether a per-request credential lookup finished before the deadline. */
  credential?: 'resolved' | 'pending' | 'none';
}

/** The host part of a URL, or the input unchanged when it does not parse. */
export function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

const seconds = (ms: number): string => `${Math.round(ms / 1000)}s`;

/** One human line for logs and triage. */
export function describeStreamFailure(d: StreamFailureDetail): string {
  const parts = [
    `destination ${d.destination.label} (${d.destination.host})`,
    d.phase === 'headers' ? 'no response headers' : 'stream failed after headers',
    `after ${seconds(d.elapsedMs)}`,
    `request ${(d.requestBytes / 1024).toFixed(1)} KB`,
    `${d.messageCount} message${d.messageCount === 1 ? '' : 's'}`,
    `${d.toolCount} tool${d.toolCount === 1 ? '' : 's'}`,
  ];
  if (d.bytesReceived !== undefined) parts.push(`${d.bytesReceived} B received`);
  if (d.credential) parts.push(`credential ${d.credential}`);
  return parts.join(' · ');
}
