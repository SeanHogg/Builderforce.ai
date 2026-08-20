/**
 * The review queue — ask for feedback on a résumé, and answer somebody else's.
 *
 * A thread, not a form. The document is frozen at request time and shown at the top of
 * every conversation, so a reviewer four days later is demonstrably reading the words the
 * question was about rather than whatever the person has edited since. The model can be
 * asked into the thread as one more participant, and a person can disagree with it in the
 * next message — which is why the model's answer is rendered as a message and not as a
 * verdict panel.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Button, EmptyState, Surface } from '@/components/ui';
import {
  careerAiApi,
  type ResumeReviewStatus,
  type ResumeReviewSummary,
  type ResumeReviewThread,
} from '@/lib/careerAiApi';
import { GradedRow, QuotedLine, fieldStyle, labelStyle, stackStyle, statusTone, textAreaStyle } from './careerAiShared';

const STATUSES: readonly ResumeReviewStatus[] = ['open', 'in_review', 'answered', 'closed'];
const MIN_RESUME = 40;

export function ReviewQueuePanel() {
  const t = useTranslations('careerAi');
  const [queue, setQueue] = useState<ResumeReviewSummary[]>([]);
  const [filter, setFilter] = useState<ResumeReviewStatus | ''>('');
  const [open, setOpen] = useState<ResumeReviewThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState({ title: '', resumeText: '', jobDescription: '', note: '' });
  const [reply, setReply] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await careerAiApi.reviews(filter || undefined);
      setQueue(response.reviews);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('error.failed'));
    } finally {
      setLoading(false);
    }
  }, [filter, t]);

  useEffect(() => { void load(); }, [load]);

  const guard = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('error.failed'));
    } finally {
      setBusy(false);
    }
  };

  const openThread = (id: string) => guard(async () => {
    const { review } = await careerAiApi.review(id);
    setOpen(review);
    await careerAiApi.markRead(id);
    await load();
  });

  const submitRequest = () => guard(async () => {
    if (draft.resumeText.trim().length < MIN_RESUME) { setError(t('error.needResume')); return; }
    const { review } = await careerAiApi.openReview({
      title: draft.title.trim() || t('reviews.defaultTitle'),
      resumeText: draft.resumeText.trim(),
      jobDescription: draft.jobDescription.trim() || undefined,
      note: draft.note.trim() || undefined,
    });
    setOpen(review);
    setComposing(false);
    setDraft({ title: '', resumeText: '', jobDescription: '', note: '' });
    await load();
  });

  const send = () => guard(async () => {
    if (!open || !reply.trim()) return;
    const { review } = await careerAiApi.reply(open.id, reply.trim(), 'answered');
    setOpen(review);
    setReply('');
    await load();
  });

  const askModel = () => guard(async () => {
    if (!open) return;
    const { review } = await careerAiApi.askModel(open.id);
    setOpen(review);
    await load();
  });

  const move = (status: ResumeReviewStatus) => guard(async () => {
    if (!open) return;
    const { review } = await careerAiApi.setStatus(open.id, status);
    setOpen(review);
    await load();
  });

  if (open) {
    return (
      <div style={stackStyle}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button variant="ghost" onClick={() => setOpen(null)}>{t('reviews.back')}</Button>
          <strong style={{ fontSize: 'var(--font-size-section)', color: 'var(--text-primary)' }}>{open.title}</strong>
          <Badge tone={statusTone(open.status)}>{t(`reviews.status.${open.status}`)}</Badge>
        </div>
        {error && <p style={{ margin: 0, color: 'var(--error-text)', fontSize: 'var(--font-size-small)' }}>{error}</p>}

        <Surface tone="sunken" padding="md">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <strong style={{ fontSize: 'var(--font-size-card-title)', color: 'var(--text-primary)' }}>{t('reviews.frozenHeading')}</strong>
            <p style={{ margin: 0, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>
              {t('reviews.frozenNote', { score: open.measuredScoreAtRequest })}
            </p>
            <pre style={{
              margin: 0, padding: 12, background: 'var(--bg-base)', borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', maxHeight: 260,
              overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'var(--font-mono)',
            }}>{open.resumeText}</pre>
          </div>
        </Surface>

        {open.messages.map((message) => (
          <Surface key={message.id} tone={message.authorKind === 'agent' ? 'accent' : 'raised'} padding="md">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>
                {message.authorKind === 'agent' ? t('reviews.author.model') : message.mine ? t('reviews.author.you') : t('reviews.author.other')}
                {' · '}
                {new Date(message.createdAtISO).toLocaleString()}
              </span>
              <p style={{ margin: 0, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{message.body}</p>
              {message.grade && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  {message.grade.categories.map((category) => (
                    <GradedRow
                      key={category.key}
                      category={category}
                      labels={{ measured: t('grade.measuredShort'), model: t('grade.modelShort'), disagrees: t('grade.disagrees') }}
                    />
                  ))}
                </div>
              )}
            </div>
          </Surface>
        ))}

        <div>
          <label htmlFor="career-ai-reply" style={labelStyle}>{t('reviews.replyLabel')}</label>
          <textarea
            id="career-ai-reply"
            style={{ ...fieldStyle, minHeight: 110, resize: 'vertical' }}
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            placeholder={t('reviews.replyPlaceholder')}
          />
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Button variant="primary" onClick={send} loading={busy} disabled={!reply.trim()}>{t('reviews.send')}</Button>
          <Button variant="secondary" onClick={askModel} loading={busy}>{t('reviews.askModel')}</Button>
          {STATUSES.filter((status) => status !== open.status).map((status) => (
            <Button key={status} variant="ghost" onClick={() => move(status)}>{t(`reviews.moveTo.${status}`)}</Button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={stackStyle}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button variant="primary" onClick={() => setComposing((current) => !current)}>{t('reviews.new')}</Button>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Button variant={filter === '' ? 'secondary' : 'ghost'} size="sm" onClick={() => setFilter('')}>{t('reviews.filterAll')}</Button>
          {STATUSES.map((status) => (
            <Button key={status} variant={filter === status ? 'secondary' : 'ghost'} size="sm" onClick={() => setFilter(status)}>
              {t(`reviews.status.${status}`)}
            </Button>
          ))}
        </div>
      </div>
      {error && <p style={{ margin: 0, color: 'var(--error-text)', fontSize: 'var(--font-size-small)' }}>{error}</p>}

      {composing && (
        <Surface tone="raised" padding="md">
          <div style={stackStyle}>
            <div>
              <label htmlFor="career-ai-review-title" style={labelStyle}>{t('reviews.titleLabel')}</label>
              <input
                id="career-ai-review-title"
                style={fieldStyle}
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                placeholder={t('reviews.titlePlaceholder')}
              />
            </div>
            <div>
              <label htmlFor="career-ai-review-resume" style={labelStyle}>{t('resumeLabel')}</label>
              <textarea
                id="career-ai-review-resume"
                style={textAreaStyle}
                value={draft.resumeText}
                onChange={(event) => setDraft({ ...draft, resumeText: event.target.value })}
                placeholder={t('resumePlaceholder')}
              />
            </div>
            <div>
              <label htmlFor="career-ai-review-note" style={labelStyle}>{t('reviews.noteLabel')}</label>
              <textarea
                id="career-ai-review-note"
                style={{ ...fieldStyle, minHeight: 90, resize: 'vertical' }}
                value={draft.note}
                onChange={(event) => setDraft({ ...draft, note: event.target.value })}
                placeholder={t('reviews.notePlaceholder')}
              />
            </div>
            <Button variant="primary" onClick={submitRequest} loading={busy}>{t('reviews.submit')}</Button>
          </div>
        </Surface>
      )}

      {loading && <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('loading')}</p>}
      {!loading && queue.length === 0 && (
        <EmptyState title={t('reviews.emptyTitle')} description={t('reviews.emptyBody')} />
      )}

      {queue.map((review) => (
        <Surface key={review.id} tone="raised" padding="md" interactive>
          <button
            type="button"
            onClick={() => openThread(review.id)}
            style={{
              all: 'unset', cursor: 'pointer', width: '100%', display: 'flex',
              gap: 12, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between',
            }}
          >
            <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <strong style={{ color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{review.title}</strong>
              <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>
                {t('reviews.messages', { count: review.messageCount })}
                {review.lastMessageAtISO ? ` · ${new Date(review.lastMessageAtISO).toLocaleDateString()}` : ''}
              </span>
            </span>
            <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {review.unread > 0 && <Badge tone="accent">{t('reviews.unread', { count: review.unread })}</Badge>}
              <Badge tone={statusTone(review.status)}>{t(`reviews.status.${review.status}`)}</Badge>
            </span>
          </button>
        </Surface>
      ))}

      {!loading && queue.length > 0 && (
        <QuotedLine muted>{t('reviews.queueNote')}</QuotedLine>
      )}
    </div>
  );
}
