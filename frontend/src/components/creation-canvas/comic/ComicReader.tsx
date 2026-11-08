import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import styles from '../styles/creativeEditors.module.css';
import { nextComicPageId, type ComicState } from '@/lib/creation/comic/comicState';
import { ComicPageView } from './ComicPageView';

interface Step {
  pageId: string;
  /** The branch taken to leave this page; absent while it is the page being read. */
  branchId?: string;
}

/**
 * Reads the comic as a reader would: a page at a time, following the choices a page
 * offers or moving on to the next page when it offers none. The path taken is a stack of
 * steps, so going back is a pop and the flags the reader has collected are derived from
 * the branches on that path rather than stored beside it.
 */
export function ComicReader({ state }: { state: ComicState }) {
  const t = useTranslations('canvas.kinds.comic');
  const [trail, setTrail] = useState<Step[]>([{ pageId: state.pages[0]!.id }]);

  const last = trail[trail.length - 1]!;
  const page = state.pages.find((entry) => entry.id === last.pageId) ?? state.pages[0]!;
  const number = state.pages.indexOf(page) + 1;
  const flags = useMemo(() => {
    const collected = new Set<string>();
    for (const step of trail) {
      const branch = state.pages.find((entry) => entry.id === step.pageId)?.branches.find((entry) => entry.id === step.branchId);
      branch?.flagsToSet.forEach((flag) => collected.add(flag));
    }
    return [...collected];
  }, [trail, state.pages]);

  const go = (branchId?: string) => {
    const next = nextComicPageId(state, page.id, branchId);
    if (!next) return;
    setTrail((steps) => [...steps.slice(0, -1), { pageId: page.id, branchId }, { pageId: next }]);
  };
  const back = () => setTrail((steps) => steps.length > 1 ? [...steps.slice(0, -2), { pageId: steps[steps.length - 2]!.pageId }] : steps);

  const hasChoices = page.branches.length > 0;
  const atEnd = !hasChoices && nextComicPageId(state, page.id) === null;

  return <div className={`${styles.reader} nodrag nowheel`} role="region" aria-label={t('readerLabel')}>
    <ComicPageView page={page} size={state} pageLabel={t('pageOf', { index: number, total: state.pages.length })} panelLabel={(index) => t('panelNumber', { index })} />
    <div className={styles.readerNav}>
      <button type="button" className={styles.button} onClick={back} disabled={trail.length < 2}>{t('back')}</button>
      <span aria-live="polite">{t('pageOf', { index: number, total: state.pages.length })}</span>
      {!hasChoices && <button type="button" className={styles.button} onClick={() => go()} disabled={atEnd}>{t('next')}</button>}
      {atEnd && trail.length > 1 && <button type="button" className={styles.button} onClick={() => setTrail([{ pageId: state.pages[0]!.id }])}>{t('startOver')}</button>}
    </div>
    {hasChoices && <div className={styles.choices} role="group" aria-label={t('choices')}>
      {page.branches.map((branch, index) => <button key={branch.id} type="button" className={styles.button} onClick={() => go(branch.id)}>
        {branch.label.trim() || t('choiceFallback', { index: index + 1 })}
      </button>)}
    </div>}
    {flags.length > 0 && <span className={styles.hint}>{t('pathFlags', { flags: flags.join(', ') })}</span>}
  </div>;
}
