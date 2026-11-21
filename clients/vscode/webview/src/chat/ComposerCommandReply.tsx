/**
 * The host's answer to a composer `/` command (PRD 31 §W11), shown beside the transcript
 * as a HOST message — never a model turn. A `/help` answer (or an unknown command, or a
 * typo's syntax) is the SAME list the `/` menu's Actions tab draws (brain-ui `ActionsPane`);
 * an outcome is its lines, the launcher's link as selectable text, and its follow-up commands.
 *
 * The link carries the launcher's per-launch token in its fragment, so it is shown for the
 * person to copy and reopened through the host (`/launch` or `/launch external`), never logged.
 */

import { useMemo } from 'react';
import { ActionsPane, type PromptOptionsCommands } from '@seanhogg/builderforce-brain-ui';
import type { ComposerReply } from '../../../src/composerCommands/reply';
import type { InitData } from '../vscodeBridge';
import { makeT, promptMenuLabels } from './chatLabels';

export function ComposerCommandReply({ reply, init, commands, onRun, onDismiss }: {
  reply: ComposerReply | null;
  init: InitData;
  /** The Actions tab's handlers — choosing an entry in a `/help` answer does what it does there. */
  commands: PromptOptionsCommands | undefined;
  /** Run a follow-up command line (`/launch`, `/launch external`). */
  onRun: (line: string) => void;
  onDismiss: () => void;
}) {
  const t = useMemo(() => makeT(init.labels), [init.labels]);
  const menuLabels = useMemo(() => promptMenuLabels(t, init.modelLabels), [t, init.modelLabels]);
  if (!reply) return null;
  const tone = reply.kind === 'text' ? reply.tone : 'info';
  return (
    <div className={`bf-command-reply bf-command-reply--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <div className="bf-command-reply__body">
        {(reply.lines ?? []).map((line, index) => <p key={index} className="bf-command-reply__line">{line}</p>)}
        {reply.kind === 'help' && (
          <div className="bf-command-reply__list">
            <ActionsPane commands={{ help: reply.help, onChoose: (id) => { onDismiss(); commands?.onChoose(id); } }} labels={menuLabels} />
          </div>
        )}
        {reply.kind === 'text' && reply.link && <code className="bf-command-reply__link">{reply.link}</code>}
        {reply.kind === 'text' && reply.actions && reply.actions.length > 0 && (
          <div className="bf-command-reply__actions">
            {reply.actions.map((action) => (
              <button key={action.command} type="button" className="bf-btn bf-command-reply__action" onClick={() => onRun(action.command)}>
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <button type="button" className="bf-btn bf-command-reply__dismiss" aria-label={t('app.dismiss', 'Dismiss')} title={t('app.dismiss', 'Dismiss')} onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}
