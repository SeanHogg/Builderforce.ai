/**
 * The "Interrupted" rows of the run list: runs the previous editor session left
 * mid-flight. Each row is titled by its chat (the title the history list uses), says when
 * it was interrupted (in the editor's locale), links the chat, and offers Resume and
 * Dismiss. Resume sends a continuation through the composer (`useInterruptedResume`):
 * it is disabled while the chat is running (with a title saying so) and, with Dismiss,
 * while a resume is pending; a resume that was never claimed leaves a note on the row.
 * Renders nothing when there are none. Rows leave as the host re-sends the list.
 */

import type { LabelBundle } from '../vscodeBridge';
import { makeT } from './chatLabels';
import { acknowledgeInterruptedRun, useInterruptedRuns } from './interruptedRunsStore';
import { interruptedWhen } from './interruptedWhen';
import type { InterruptedResume } from './useInterruptedResume';

interface Props {
  bundle: LabelBundle;
  /** The editor's locale (`init.locale`) the time is shown in. */
  locale: string | undefined;
  /** The chat's title, as the history list shows it; undefined when the chat is unknown. */
  titleOf: (chatId: number) => string | undefined;
  /** Open a chat by its (local) id. */
  onOpenChat: (chatId: number) => void;
  resume: InterruptedResume;
}

export function InterruptedRuns({ bundle, locale, titleOf, onOpenChat, resume }: Props) {
  const runs = useInterruptedRuns();
  const t = makeT(bundle);
  if (runs.length === 0) return null;
  return (
    <section className="bf-interrupted" aria-label={t('ir.title', 'Interrupted runs')}>
      <h3 className="bf-interrupted__title">{t('ir.title', 'Interrupted runs')} ({runs.length})</h3>
      <ul className="bf-interrupted__list">
        {runs.map((run) => {
          const chatId = run.chatId != null ? Number(run.chatId) : NaN;
          const hasChat = Number.isInteger(chatId);
          const pending = resume.pending.has(run.runId);
          const running = hasChat && resume.isRunning(chatId);
          return (
            <li key={run.runId} className="bf-interrupted__row">
              <div className="bf-interrupted__who">
                <strong className="bf-interrupted__run">{(hasChat ? titleOf(chatId) : undefined) ?? run.runId.slice(0, 8)}</strong>
                <span className="bf-interrupted__when">{t('ir.at', 'Interrupted {when}').replace('{when}', interruptedWhen(run.interruptedAt, locale))}</span>
              </div>
              {resume.failed.has(run.runId) && !pending && (
                <div className="bf-interrupted__note" role="alert">{t('ir.failed', "Couldn't resume")}</div>
              )}
              <div className="bf-interrupted__actions">
                {hasChat && (
                  <button type="button" className="bf-btn" onClick={() => onOpenChat(chatId)}>{t('ir.openChat', 'Open chat')}</button>
                )}
                {hasChat && (
                  <button
                    type="button"
                    className="bf-btn"
                    disabled={pending || running}
                    title={running ? t('ir.busy', 'This chat is running') : undefined}
                    onClick={() => resume.resume({ runId: run.runId, chatId })}
                  >
                    {t('ir.resume', 'Resume')}
                  </button>
                )}
                <button type="button" className="bf-btn" disabled={pending} onClick={() => acknowledgeInterruptedRun(run.runId)}>{t('ir.dismiss', 'Dismiss')}</button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
