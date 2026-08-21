'use client';

/**
 * THE participant's surface — a phone, in a room, with no account.
 *
 * ── WHAT THIS IS THE OTHER HALF OF ──────────────────────────────────────────
 * The canvas could hold a `timer` and a `comment` thread and nothing else a person
 * running a room actually uses. This is where an answer comes back from somebody who is
 * not in the workspace, has not signed up, and is holding a phone.
 *
 * ── THE RULES THAT ARE *NOT* HERE ───────────────────────────────────────────
 * Whether voting is open, whether the room may see the count, whether a quiz's answer
 * may be shown, and whether a chosen option is even on the ballot are all decided on the
 * SERVER (`pollFacilitation.ts`). The client checks what it can so a participant gets an
 * immediate answer, and the server checks everything because the client is not the thing
 * that protects anybody. Neither is authoritative by accident.
 *
 * ── WHY IT POLLS, AND WHY THAT IS NOT A COMPROMISE ──────────────────────────
 * A live count on a phone has to move without the participant doing anything. The canvas
 * relay is a tenant-authenticated Durable Object and this visitor has no tenant, so the
 * honest options were a second public socket or a short interval over the read that
 * already exists. The interval wins: a poll lives for minutes, the read is bounded and
 * indexed, and it stops the moment the tab is hidden — a phone in a pocket must not be
 * fetching a tally.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ParticipantPollView } from '@/lib/pollApi';
import { castVote, participantId, publicPoll } from '@/lib/pollApi';
import { pollAnswerIsEmpty } from '@builderforce/creation-canvas-contract';
import { PollAnswerControl } from './PollAnswerControl';
import { PollResults } from './PollResults';
import styles from './PollJoin.module.css';

/** How often the room's count is re-read while the tab is visible. Four seconds is
 *  under the threshold at which a facilitator says "is this thing working" and well
 *  over the rate at which a bounded indexed read costs anything. */
const REFRESH_MS = 4000;

type State =
  | { status: 'loading' }
  | { status: 'ready'; view: ParticipantPollView }
  | { status: 'missing' };

export function PollJoin({ slug }: { slug: string }) {
  const t = useTranslations('poll');
  const [state, setState] = useState<State>({ status: 'loading' });
  const [answer, setAnswer] = useState<unknown>(null);
  const [voted, setVoted] = useState(false);
  const [changing, setChanging] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Minted on first use rather than at render, so a page nobody votes on writes nothing
  // to a stranger's storage.
  const participant = useRef<string | null>(null);

  const read = useCallback(async () => {
    try {
      const view = await publicPoll(slug);
      setState({ status: 'ready', view });
    } catch {
      setState((current) => (current.status === 'ready' ? current : { status: 'missing' }));
    }
  }, [slug]);

  useEffect(() => { void read(); }, [read]);

  useEffect(() => {
    // Stopped while the tab is hidden: a phone in a pocket must not be fetching a tally,
    // and every device in the room is one of these.
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (!timer) timer = setInterval(() => { void read(); }, REFRESH_MS); };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const onVisibility = () => (document.hidden ? stop() : (void read(), start()));
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [read]);

  const view = state.status === 'ready' ? state.view : null;
  const poll = view?.poll ?? null;
  const answerBlank = useMemo(
    () => !poll || pollAnswerIsEmpty(poll.format, answer),
    [poll, answer],
  );

  if (state.status === 'loading') {
    return <main className={styles.page}><div className={styles.sheet}><p className={styles.notice}>{t('loading')}</p></div></main>;
  }
  if (state.status === 'missing' || !poll || !view) {
    return <main className={styles.page} role="alert"><div className={styles.sheet}><p className={styles.notice}>{t('missing')}</p></div></main>;
  }

  const closed = poll.status !== 'open';
  const showControl = !closed && (!voted || changing);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (answerBlank) { setError(t('answerFirst')); return; }
    setSending(true);
    try {
      participant.current ??= participantId(slug);
      const result = await castVote(slug, participant.current, answer);
      setVoted(true);
      setChanging(false);
      setState({ status: 'ready', view: { ...view, tally: result.tally, resultsVisible: result.resultsVisible } });
    } catch (voteError) {
      setError(voteError instanceof Error ? voteError.message : t('voteFailed'));
    } finally {
      setSending(false);
    }
  };

  return (
    <main className={styles.page}>
      <form className={styles.sheet} onSubmit={submit} noValidate>
        <h1 className={styles.title}>{poll.title}</h1>
        {poll.prompt && <p className={styles.description}>{poll.prompt}</p>}
        <p className={styles.meta}>
          {/* Stated up front, never in small print afterwards: whether an answer is
              attributed is the single fact that changes what a person is willing to
              say, and telling them later is telling them too late. */}
          <span>{poll.anonymous ? t('anonymousYes') : t('anonymousNo')}</span>
          {closed && <span>{t('votingClosed')}</span>}
        </p>

        {showControl && (
          <>
            <PollAnswerControl
              format={poll.format}
              options={poll.options}
              scaleMax={poll.scaleMax}
              grid={poll.grid}
              value={answer}
              onChange={setAnswer}
              disabled={sending}
            />
            {error && <p className={styles.error} role="alert">{error}</p>}
            <div className={styles.actions}>
              <button type="submit" className={styles.submit} disabled={sending || answerBlank}>
                {sending ? t('sending') : voted ? t('updateVote') : t('sendVote')}
              </button>
            </div>
          </>
        )}

        {voted && !changing && !closed && (
          <>
            <p className={styles.notice}>{t('voteRecorded')}</p>
            {/* Changing your mind REPLACES your vote rather than adding one — see
                `participantId`. Offered plainly, because a room that cannot correct a
                mis-tap answers the next question more slowly. */}
            <button type="button" className={styles.change} onClick={() => setChanging(true)}>{t('changeVote')}</button>
          </>
        )}

        {view.resultsVisible ? (
          <div className={styles.results}>
            <h2 className={styles.resultsHeading}>{t('resultsHeading')}</h2>
            <PollResults tally={view.tally} grid={poll.grid} />
          </div>
        ) : (
          voted && <p className={styles.notice}>{t('resultsHidden')}</p>
        )}
      </form>
    </main>
  );
}
