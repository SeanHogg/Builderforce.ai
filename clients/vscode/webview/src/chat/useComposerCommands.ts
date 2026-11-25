/**
 * The composer's `/` commands in the editor chat (PRD 31 §W11): the seam in front of the
 * ONE turn door (`useChatSend().submit`).
 *
 * A line that can be a command (`/x…` or the `//` escape — Rev 2 item 10) is handed to the
 * HOST first (`composer.input`), which parses it with brain-embedded's registry and runs it
 * there — `/help`, `/starter-kit`, `/manifest init`, `/launch`. Its reply is shown beside the
 * transcript as a host message; the line never reaches a model. Anything the host says is not
 * a command (`/api/users returns 500`, an escaped `//…`) goes through the turn door as usual.
 *
 * It also gives the `/` menu its Actions tab: the host's `/help` model (`init.composerCommands`),
 * where an entry with no required argument runs at once and any other is put in the box.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ComposerDraftStore } from '@seanhogg/builderforce-brain-embedded';
import type { PromptOptionsCommands } from '@seanhogg/builderforce-brain-ui';
import { COMPOSER_COMMANDS_FRAME } from '../../../src/panels/bridgeProtocol';
import type { ComposerCommandsInit, ComposerInputResult, ComposerReply } from '../../../src/composerCommands/reply';
import type { ComposerCommandsFrame } from '../bridge/bridgeTypes';
import { onHostMessage, request, type InitData } from '../bridge/vscodeBridge';

/** Only these lines can be commands; anything else goes straight through the turn door. */
const MAY_BE_COMMAND = /^\s*\/(?:\/|[a-z])/;

export function mayBeComposerCommand(text: string): boolean {
  return MAY_BE_COMMAND.test(text);
}

export function useComposerCommands({ init, draftStore, submit, seed }: {
  init: InitData;
  draftStore: ComposerDraftStore;
  /** The turn door's submit (`useChatSend().submit`): sends what the box holds. */
  submit: () => void;
  /** Put text in the box and focus it (an Actions entry that needs arguments). */
  seed: (text: string) => void;
}) {
  const [reply, setReply] = useState<ComposerReply | null>(null);

  /** Ask the host to answer a line. A refused request (no host, timed out) is shown, never sent to the model. */
  const ask = useCallback(async (line: string): Promise<ComposerInputResult | undefined> => {
    try {
      return await request<ComposerInputResult>('composer.input', { text: line });
    } catch (error) {
      setReply({ kind: 'text', tone: 'error', lines: [error instanceof Error ? error.message : String(error)] });
      return undefined;
    }
  }, []);

  /** Run a command line the person did not type in the box (an Actions entry, a reply's follow-up). */
  const run = useCallback((line: string) => {
    void ask(line).then((result) => {
      if (result?.handled) setReply(result.reply);
    });
  }, [ask]);

  const submitLine = useCallback(() => {
    const text = draftStore.get().trim();
    if (!mayBeComposerCommand(text)) {
      submit();
      return;
    }
    draftStore.set('');
    void ask(text).then((result) => {
      if (!result) {
        draftStore.set(text); // the line goes back to the box; it is never sent as a message unanswered
        return;
      }
      if (result.handled) {
        setReply(result.reply);
        return;
      }
      // Not a command: the turn door sends it (an escaped `//…` with its one slash removed).
      draftStore.set(result.text ?? text);
      submit();
    });
  }, [draftStore, submit, ask]);

  /** Alt+Enter's "queue for after the run": a command is answered now (it starts no run), anything else is queued. */
  const queueOr = useCallback((queueAfter: () => void) => () => {
    if (mayBeComposerCommand(draftStore.get().trim())) submitLine();
    else queueAfter();
  }, [draftStore, submitLine]);

  // The host recomputes the model when the workspace changes (a folder, a folder's manifest) and
  // pushes it; that replaces the one `init` carried until the next `init` brings its own.
  const [pushed, setPushed] = useState<{ from: InitData; model: ComposerCommandsInit } | null>(null);
  useEffect(() => onHostMessage<ComposerCommandsFrame>(COMPOSER_COMMANDS_FRAME, (frame) => {
    if (frame.composerCommands) setPushed({ from: init, model: frame.composerCommands });
  }), [init]);
  const help = (pushed?.from === init ? pushed.model : init.composerCommands)?.help;
  const commands = useMemo<PromptOptionsCommands | undefined>(() => (help ? {
    help,
    onChoose: (id) => {
      const entry = help.entries.find((candidate) => candidate.id === id);
      if (!entry) return;
      if (entry.runnable) run(`/${entry.id}`);
      else seed(entry.insertText);
    },
  } : undefined), [help, run, seed]);

  const dismiss = useCallback(() => setReply(null), []);
  return { submit: submitLine, queueOr, reply, dismiss, run, commands };
}
