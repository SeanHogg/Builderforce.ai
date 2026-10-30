/**
 * Test support: a draft host in miniature - the real creation hook (`useChatCreation`) under the real turn door (`useChatTurns`).
 * The test drives which chat is showing. Nothing in the product imports it. (The importing test file mocks `./brainRunStore`.)
 */
import { useRef, useState } from 'react';
import { drainRunSteering } from '../runSteering';
import { useChatCreation } from '../useChatCreation';
import { useChatTurns } from '../useChatTurns';

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

export interface HostPorts {
  /** Creates (and, in a real host, selects) the draft's chat. */
  create: () => Promise<number | null>;
  /** The host's send for one turn: `ensure` is the conversation's `ensureChatId` (called with the send's own token); `chatNow` reads the chat showing. */
  send: (text: string, ensure: () => Promise<number | null>, chatNow: () => number | null) => Promise<boolean>;
  restore: (turn: string) => void;
}

export function useDraftHost(ports: HostPorts) {
  const [chatId, setChatId] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [steerable, setSteerable] = useState(false);
  const chatRef = useRef(chatId);
  chatRef.current = chatId;
  const { ensureChatId, drafts } = useChatCreation({ chatId, create: ports.create });
  const turns = useChatTurns<string>({
    running,
    steerable,
    runKey: chatId,
    drafts,
    // what `conv.send` does with `opts.draft`: the creation it triggers is THIS send's token's
    send: (text, ctx) => { setRunning(true); return ports.send(text, () => ensureChatId(ctx?.draft), () => chatRef.current); },
    isDirected: () => false,
    restore: ports.restore,
    join: (held) => held.join('\n\n'),
  });
  return { setChatId, setRunning, setSteerable, turns };
}

export const sendViaCreation: HostPorts['send'] = async (_text, ensure) => (await ensure()) != null;
export const held = (host: { turns: { queued: { items: readonly { value: string }[] } } }) => host.turns.queued.items.map((i) => i.value);
export const texts = (chat: number) => drainRunSteering(chat).map((m) => m.text);
