'use client';

/**
 * THE transclusion — another document, shown HERE, live.
 *
 * ── WHAT THIS IS ────────────────────────────────────────────────────────────
 * Not a copy and not a link. The card renders the referenced knowledge document's own
 * CURRENT content, so a board can put the same SOP in two contexts without either of
 * them going stale, and editing the document updates every board it appears on.
 *
 * `url` points AWAY from the workspace; `knowledge` IS a knowledge item authored on the
 * board. Neither says "show me that one, over there, as it is right now" — which is the
 * knowledge board's `embed` block, and the second of the two primitives that surface had
 * and the canvas which is the front door did not.
 *
 * ── WHY IT READS ON MOUNT AND NOT ON EVERY RENDER ───────────────────────────
 * A board can hold many of these, and each is one document fetch. Read once per id, kept
 * in local state, and NOT written back into the node: a transclusion that cached the body
 * onto the card would be a copy, which is the exact thing it exists not to be.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { DocumentMarkdown } from '@/components/DocumentMarkdown';
import { knowledgeApi } from '@/lib/knowledgeApi';
import type { CreationNodeData } from './types';
import styles from './CreationCanvas.module.css';

/** How much of a long document a CARD shows. The whole point of a card is that it is
 *  glanceable; the link below opens the document itself, which is where a person goes to
 *  read all of it. */
const CARD_EXCERPT_CHARS = 900;

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; title: string; content: string; truncated: boolean }
  | { status: 'missing' };

export function CanvasTransclusionBody({ data }: { data: CreationNodeData }) {
  const t = useTranslations('creationCanvas.transclusion');
  const documentId = typeof data.documentId === 'string' ? data.documentId.trim() : '';
  const [state, setState] = useState<State>({ status: 'idle' });

  useEffect(() => {
    if (!documentId) { setState({ status: 'idle' }); return undefined; }
    let cancelled = false;
    setState({ status: 'loading' });
    knowledgeApi.get(documentId)
      .then((doc) => {
        if (cancelled) return;
        const body = doc.content ?? '';
        setState({
          status: 'ready',
          title: doc.title,
          content: body.slice(0, CARD_EXCERPT_CHARS),
          truncated: body.length > CARD_EXCERPT_CHARS,
        });
      })
      .catch(() => { if (!cancelled) setState({ status: 'missing' }); });
    return () => { cancelled = true; };
  }, [documentId]);

  if (!documentId) return <p className={styles.transclusionNotice}>{t('chooseDocument')}</p>;
  if (state.status === 'loading' || state.status === 'idle') {
    return <p className={styles.transclusionNotice}>{t('loading')}</p>;
  }
  // Named rather than blank: a reference to a document that has been deleted or that this
  // person cannot read are both real, and a card that silently shows nothing looks like a
  // card that is still loading.
  if (state.status === 'missing') return <p className={styles.transclusionNotice} role="alert">{t('unavailable')}</p>;

  return (
    <div className={styles.transclusionBody}>
      <strong>{state.title}</strong>
      {state.content.trim()
        ? <DocumentMarkdown content={state.content} />
        : <p className={styles.transclusionNotice}>{t('empty')}</p>}
      <Link href={`/knowledge/${documentId}`} className={styles.transclusionLink}>
        {state.truncated ? t('readAll') : t('openDocument')}
      </Link>
    </div>
  );
}
