import type { CreationNodeData } from '../types';
import { type CreationSessionActivity, type CreationSessionComment, creationSessionsApi, type CreationSessionSummary } from '@/lib/builderforceApi';
import { useFormat } from '@/i18n/useFormat';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { activeResumeRevision, resumeFamilyFromNode } from '@/lib/canvasResume';
import { faultText } from '@/lib/apiClient';
import styles from '../CreationCanvas.module.css';

export function ActivityInspector({ sessionId, objectId, data, persistence, role, members }: { sessionId: string; objectId: string; data: CreationNodeData; persistence: 'local' | 'server'; role: CreationSessionSummary['role']; members: Array<{ userId: string; displayName: string | null; role: string }> }) {
  const fmt = useFormat();
  const t = useTranslations('creationCanvas');
  const [comments, setComments] = useState<CreationSessionComment[]>([]);
  const [activity, setActivity] = useState<CreationSessionActivity[]>([]);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState(persistence === 'local' ? 'Save this session to collaborate.' : t('noticeLoadingActivity'));
  const resumeFamily = data.kind === 'resume' ? resumeFamilyFromNode(data) : null;
  const resumeRevision = resumeFamily ? activeResumeRevision(resumeFamily) : null;
  const [resumeSection, setResumeSection] = useState('basics');
  const [resumeField, setResumeField] = useState('summary');
  const canComment = role !== 'viewer';

  const reload = useCallback(async () => {
    if (persistence !== 'server') return;
    try {
      const [commentResult, activityResult] = await Promise.all([
        creationSessionsApi.comments.list(sessionId, objectId),
        creationSessionsApi.activity(sessionId, 50),
      ]);
      setComments(commentResult.comments);
      setActivity(activityResult.activity.filter((item) => !item.objectId || item.objectId === objectId));
      setStatus(commentResult.comments.length || activityResult.activity.length ? '' : t('noticeNoActivityYet'));
    } catch (error) {
      setStatus(faultText(error, t('noticeLoadActivityFailed')));
    }
  }, [objectId, persistence, sessionId, t]);

  useEffect(() => { void reload(); }, [reload]);

  const submit = () => {
    const body = draft.trim();
    if (!body || persistence !== 'server' || !canComment) return;
    const normalized = body.toLowerCase();
    const mentions = members.filter((member) => member.displayName && normalized.includes(`@${member.displayName.toLowerCase()}`)).map((member) => member.userId);
    setStatus('Posting comment…');
    const anchor: CreationSessionComment['anchor'] = resumeRevision ? { kind: 'resume-field', revisionId: resumeRevision.id, section: resumeSection, ...(resumeField ? { field: resumeField } : {}) } : null;
    void creationSessionsApi.comments.create(sessionId, { body, objectId, mentions, ...(anchor ? { anchor } : {}) }).then(() => {
      setDraft('');
      setStatus('Comment posted');
      void reload();
    }).catch((error) => setStatus(faultText(error, t('noticePostCommentFailed'))));
  };

  const resolve = (comment: CreationSessionComment) => {
    void creationSessionsApi.comments.resolve(sessionId, comment.id, !comment.resolvedAt).then(() => void reload())
      .catch((error) => setStatus(faultText(error, t('commentUpdateFailed'))));
  };

  if (persistence === 'local') return <div className={styles.activityEmpty}><strong>{t('collaborationStartsOnSave')}</strong><p>{t('collaborationStartsHint')}</p></div>;

  return <div className={styles.activityPanel}>
    <section className={styles.commentComposer}>
      {resumeRevision && <div className={styles.commentAnchorFields}>
        <label>{t('resumeCommentSection')}<select value={resumeSection} onChange={(event) => setResumeSection(event.target.value)}>{['basics', 'work', 'education', 'skills', 'volunteer', 'projects', 'awards', 'certificates', 'publications', 'languages', 'interests', 'references'].map((section) => <option key={section} value={section}>{t(`resumeCommentSection_${section}`)}</option>)}</select></label>
        <label>{t('resumeCommentField')}<input value={resumeField} onChange={(event) => setResumeField(event.target.value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64))} placeholder={t('resumeCommentFieldPlaceholder')} /></label>
      </div>}
      <label>{t('commentOnObject')}<textarea rows={3} value={draft} disabled={!canComment} onChange={(event) => setDraft(event.target.value)} placeholder={canComment ? t('commentPlaceholder') : t('viewOnlyAccess')} /></label>
      <button className={styles.fullButton} disabled={!canComment || !draft.trim()} onClick={submit}>{t('postComment')}</button>
    </section>
    {status && <p className={styles.inspectorHint}>{status}</p>}
    <section className={styles.commentList} aria-label={t('objectComments')}>
      {comments.map((comment) => <article key={comment.id} className={comment.resolvedAt ? styles.commentResolved : ''}>
        <header><b>{comment.authorName || t('collaborator')}</b><time>{fmt.dateTime(comment.createdAt)}</time></header>
        <p>{comment.body}</p>
        {comment.anchor?.kind === 'resume-field' && <small className={styles.commentAnchor}>{t('resumeCommentAnchor', { section: t(`resumeCommentSection_${comment.anchor.section}`), field: comment.anchor.field || t('resumeCommentWholeSection') })}</small>}
        {canComment && <button onClick={() => resolve(comment)}>{comment.resolvedAt ? t('reopen') : t('resolve')}</button>}
      </article>)}
    </section>
    <section className={styles.activityList} aria-label={t('objectActivity')}>
      <h4>{t('recentActivity')}</h4>
      {activity.filter((item) => item.kind === 'event').map((item) => <div key={item.id}><span>•</span><p><b>{item.actorName || 'BuilderForce'}</b>{` ${item.type.replaceAll('.', ' ')}`}</p><time>{fmt.dateTime(item.createdAt)}</time></div>)}
    </section>
  </div>;
}
