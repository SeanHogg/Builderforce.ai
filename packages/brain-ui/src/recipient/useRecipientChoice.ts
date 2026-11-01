import { useEffect, useMemo, useState } from 'react';
import {
  mentionRecipient,
  resolveRecipient,
  useDraftSelector,
  type ComposerDraftStore,
  type DirectedRecipient,
  type RecipientChoice,
} from '@seanhogg/builderforce-brain-embedded';
import { UNUSED_STORE } from '../composer/unusedDraftStore';

/**
 * Who the next message goes to, as composer state — shared by every composer so
 * routing behaves identically on the web and in the editor.
 *
 * `choice` is the explicit pick (`null` = auto, `'brain'`, or a participant). It resets
 * when `resetKey` changes (switching chats) and drops a participant who has since left
 * the roster. The effective `recipient` then follows {@link resolveRecipient}: an
 * explicit BRAIN pick wins, else an explicit participant, else a leading @mention in
 * the text, else the BRAIN (null).
 *
 * The text is the host's `input` string (it re-renders the host per key) OR its `draftStore`: then this hook subscribes
 * to the one fact it needs - WHO the leading @mention names - so the host re-renders when that changes, not per key.
 */
export function useRecipientChoice({ participants, input, draftStore, resetKey }: {
  participants: DirectedRecipient[];
  input?: string;
  draftStore?: ComposerDraftStore;
  resetKey: unknown;
}) {
  const [choice, setChoice] = useState<RecipientChoice>(null);
  useEffect(() => { setChoice(null); }, [resetKey]);
  useEffect(() => {
    setChoice((c) => (c && c !== 'brain' && !participants.some((p) => p.kind === c.kind && p.ref === c.ref) ? null : c));
  }, [participants]);
  const fromInput = useMemo(() => mentionRecipient(input ?? '', participants), [input, participants]);
  // The draft-store read must be a STABLE snapshot: `useSyncExternalStore` compares it with
  // Object.is on every write, so a fresh object per keystroke re-renders the host per key.
  // Resolve to the participant's (kind, ref) — a stable primitive key for equal answers —
  // then look the LIVE member back up, so the returned object is the list's own (one identity).
  const mentionedKey = useDraftSelector(
    draftStore ?? UNUSED_STORE,
    (text) => { const m = mentionRecipient(text, participants); return m ? `${m.kind}:${m.ref}` : null; },
  );
  const mentioned = draftStore
    ? participants.find((p) => mentionedKey !== null && `${p.kind}:${p.ref}` === mentionedKey) ?? null
    : fromInput;
  return { recipient: resolveRecipient(choice, mentioned), choice, choose: setChoice };
}
