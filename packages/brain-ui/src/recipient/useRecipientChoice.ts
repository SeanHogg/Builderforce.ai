import { useEffect, useMemo, useState } from 'react';
import {
  mentionRecipient,
  resolveRecipient,
  type DirectedRecipient,
  type RecipientChoice,
} from '@seanhogg/builderforce-brain-embedded';

/**
 * Who the next message goes to, as composer state — shared by every composer so
 * routing behaves identically on the web and in the editor.
 *
 * `choice` is the explicit pick (`null` = auto, `'brain'`, or a participant). It resets
 * when `resetKey` changes (switching chats) and drops a participant who has since left
 * the roster. The effective `recipient` then follows {@link resolveRecipient}: an
 * explicit BRAIN pick wins, else an explicit participant, else a leading @mention in
 * `input`, else the BRAIN (null).
 */
export function useRecipientChoice({ participants, input, resetKey }: {
  participants: DirectedRecipient[];
  input: string;
  resetKey: unknown;
}) {
  const [choice, setChoice] = useState<RecipientChoice>(null);
  useEffect(() => { setChoice(null); }, [resetKey]);
  useEffect(() => {
    setChoice((c) => (c && c !== 'brain' && !participants.some((p) => p.kind === c.kind && p.ref === c.ref) ? null : c));
  }, [participants]);
  const mentioned = useMemo(() => mentionRecipient(input, participants), [input, participants]);
  return { recipient: resolveRecipient(choice, mentioned), choice, choose: setChoice };
}
