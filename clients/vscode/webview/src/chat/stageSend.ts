/**
 * The wait between "send" and "send": the editor chat fetches a per-turn limbic block (up to 4 s)
 * before `conv.send` starts. In that window the person can press Stop or switch chats; what comes back
 * says whether the send may go on. A send that outlasts a chat switch must NEVER be sent into the chat
 * now showing - it is another chat's turn - so the caller returns it to the composer instead.
 */

export type Staged =
  | { ready: true; block: string }
  | { ready: false; why: 'stopped' | 'switched' };

export async function stageSend(opts: {
  /** The chat the turn was typed in. */
  startedIn: number | null;
  /** The chat showing now (read after the fetch, never captured). */
  currentChat: () => number | null;
  /** A Stop landed while it got ready. */
  stopped: () => boolean;
  fetchBlock: () => Promise<string>;
}): Promise<Staged> {
  const block = await opts.fetchBlock();
  if (opts.stopped()) return { ready: false, why: 'stopped' };
  if (opts.currentChat() !== opts.startedIn) return { ready: false, why: 'switched' };
  return { ready: true, block };
}
