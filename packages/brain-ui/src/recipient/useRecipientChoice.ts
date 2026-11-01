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
  const fromStore = useDraftSelector(draftStore ?? UNUSED_STORE, (text) => mentionRecipient(text, participants));
  const mentioned = draftStore ? fromStore : fromInput;
  return { recipient: resolveRecipient(choice, mentioned), choice, choose: setChoice };
}
