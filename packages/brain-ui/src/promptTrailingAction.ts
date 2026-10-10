/**
 * What a composer's ONE trailing button is right now: the mic, Send, or Stop.
 *
 * Every prompt surface — the web composer, the editor panel, the desktop app — used
 * to answer this on its own, so the editor showed a mic in the text row AND a Send
 * button, and Stop beside a Queue button, while the web shared one slot. They are never
 * useful at the same time, so one slot holds whichever applies:
 *
 * - a live recording keeps the mic (as Stop dictation) in place, even once phrases land
 *   in the box — otherwise the first phrase would swap it for Send and strand the
 *   recording;
 * - text to send wins next, including mid-run, where Send queues the follow-up;
 * - an empty box during a run interrupts it;
 * - an empty idle box offers the mic, where the runtime can listen;
 * - otherwise Send, disabled until there is text.
 */
export type PromptTrailingAction = 'voice' | 'send' | 'stop';

export interface PromptTrailingState {
  /** The box holds text the host would accept now. */
  canSubmit: boolean;
  /** A turn is streaming. */
  running: boolean;
  /** The host can interrupt the running turn. */
  canStop: boolean;
  /** The host offers dictation AND the runtime supports it. */
  voice: boolean;
  /** Dictation is live. */
  recording: boolean;
}

export function promptTrailingAction({ canSubmit, running, canStop, voice, recording }: PromptTrailingState): PromptTrailingAction {
  if (recording) return 'voice';
  if (canSubmit) return 'send';
  if (running && canStop) return 'stop';
  if (voice) return 'voice';
  return 'send';
}
