'use client';

/**
 * Product Updates — the platform changelog, opened by clicking the version number
 * in the footer (and auto-opened by `?whatsnew=1`, the deep link the weekly
 * digest email's CTA uses). Renders the PUBLIC published release notes, newest
 * first, in the canonical SlideOutPanel.
 *
 * Each update carries its lifecycle STAGE, so "what changed" and "what is still
 * in beta" are one list rather than two: an update on an open beta stage offers
 * the same join/leave flow the banner does, through the same panel and the same
 * store — join here and the banner is gone before the next render.
 *
 * The list is fetched once per page lifetime (module-level promise cache):
 * the API side is already read-through-cached, this just avoids refetching on
 * every reopen of the panel.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SlideOutPanel } from './SlideOutPanel';
import BetaJoinPanel from './beta/BetaJoinPanel';
import {
  CategoryBadge,
  ReleaseNoteBody,
  StageBadge,
  isBetaStage,
  useReleaseNoteDate,
  useReleaseNoteMonth,
} from './releaseNotes/ReleaseNoteParts';
import { useBetaPrograms } from '@/lib/betaPrograms';
import { fetchReleaseNotes, type BetaProgram, type ReleaseNote } from '@/lib/releaseNotesApi';
import styles from './WhatsNewPanel.module.css';

let notesPromise: Promise<ReleaseNote[]> | null = null;

function loadNotesOnce(): Promise<ReleaseNote[]> {
  if (!notesPromise) {
    notesPromise = fetchReleaseNotes().catch((err) => {
      notesPromise = null; // a failed load must not be cached forever
      throw err;
    });
  }
  return notesPromise;
}

type CategoryFilter = 'all' | 'new' | 'improvement' | 'fix';

const FILTERS: CategoryFilter[] = ['all', 'new', 'improvement', 'fix'];

function noteTimestamp(note: ReleaseNote): string {
  return note.publishedAt ?? note.createdAt;
}

export default function WhatsNewPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('whatsNew');
  const tBeta = useTranslations('beta');
  const fmtDate = useReleaseNoteDate();
  const fmtMonth = useReleaseNoteMonth();
  const { betas } = useBetaPrograms();
  const [notes, setNotes] = useState<ReleaseNote[] | null>(null);
  const [error, setError] = useState(false);
  const [joining, setJoining] = useState<BetaProgram | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CategoryFilter>('all');

  useEffect(() => {
    if (!open || notes !== null) return;
    let cancelled = false;
    setError(false);
    loadNotesOnce()
      .then((loaded) => { if (!cancelled) setNotes(loaded); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [open, notes]);

  // The changelog is public; enrolment is per person. Indexing the betas the
  // signed-in user can act on lets a note render its own join state without this
  // panel re-deciding who is eligible — the server already did.
  const joinable = useMemo(() => new Map(betas.map((b) => [b.id, b])), [betas]);

  const visibleNotes = useMemo(() => {
    if (notes === null) return [];
    const needle = query.trim().toLocaleLowerCase();
    return notes.filter((note) => {
      const matchesCategory = category === 'all' || note.category === category;
      const searchable = `${note.title} ${note.body ?? ''} ${note.version}`.toLocaleLowerCase();
      return matchesCategory && (!needle || searchable.includes(needle));
    });
  }, [category, notes, query]);

  const groupedNotes = useMemo(() => {
    const groups: Array<{ month: string; notes: ReleaseNote[] }> = [];
    visibleNotes.forEach((note) => {
      const month = fmtMonth(noteTimestamp(note));
      const previous = groups.at(-1);
      if (previous?.month === month) previous.notes.push(note);
      else groups.push({ month, notes: [note] });
    });
    return groups;
  }, [fmtMonth, visibleNotes]);

  const resetFilters = () => {
    setQuery('');
    setCategory('all');
  };

  return (
    <>
      <SlideOutPanel open={open} onClose={onClose} title={t('title')} width="wide" widthStorageKey="whats-new">
        <div className={styles.catalog}>
          <div className={styles.intro}>
            <span className="ui-eyebrow">{t('eyebrow')}</span>
            <p>{t('description')}</p>
            {notes !== null && notes.length > 0 && (
              <span className={styles.total}>{t('updateCount', { count: notes.length })}</span>
            )}
          </div>

          {notes !== null && notes.length > 0 && (
            <div className={styles.controls}>
              <label className={styles.search}>
                <svg aria-hidden viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-4-4" />
                </svg>
                <span className="sr-only">{t('searchLabel')}</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('searchPlaceholder')}
                />
              </label>
              <div className={styles.filters} aria-label={t('filterLabel')}>
                {FILTERS.map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    className={category === filter ? styles.filterActive : undefined}
                    aria-pressed={category === filter}
                    onClick={() => setCategory(filter)}
                  >
                    {filter === 'all' ? t('filters.all') : t(`categories.${filter}`)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {error ? (
            <div className={styles.state}>{t('error')}</div>
          ) : notes === null ? (
            <div className={styles.loading} role="status" aria-label={t('loading')}>
              <span /><span /><span />
            </div>
          ) : notes.length === 0 ? (
            <div className={styles.state}>{t('empty')}</div>
          ) : visibleNotes.length === 0 ? (
            <div className={styles.state}>
              <strong>{t('noResultsTitle')}</strong>
              <span>{t('noResultsBody')}</span>
              <button type="button" className="btn-ghost" onClick={resetFilters}>
                {t('clearFilters')}
              </button>
            </div>
          ) : (
            <div className={styles.timeline}>
              <div className={styles.results} aria-live="polite">
                {t('showingCount', { count: visibleNotes.length })}
              </div>
              {groupedNotes.map((group) => (
                <section key={group.month} className={styles.monthGroup} aria-label={group.month}>
                  <div className={styles.monthHeading}>
                    <span>{group.month}</span>
                    <i aria-hidden />
                  </div>
                  {group.notes.map((note) => {
                    const beta = joinable.get(note.id) ?? null;
                    return (
                      <article key={note.id} className={styles.note} data-category={note.category}>
                        <div className={styles.noteMeta}>
                          <CategoryBadge category={note.category} />
                          {/* 'live' is the resting state — badging every shipped note
                              with it would say nothing. Stages that mean something to a
                              reader (in development, in beta, sunsetting) are shown. */}
                          {note.stage !== 'live' && <StageBadge stage={note.stage} />}
                          {note.id === notes[0]?.id && <span className={styles.latest}>{t('latest')}</span>}
                          <span className={styles.version}>v{note.version}</span>
                          {note.publishedAt && (
                            <span className={styles.date}>{fmtDate(note.publishedAt)}</span>
                          )}
                        </div>
                        <h3 className={styles.noteTitle}>{note.title}</h3>
                        <ReleaseNoteBody body={note.body} />

                        {note.stageEndsAt && isBetaStage(note.stage) && (
                          <p className={styles.rollout}>
                            {tBeta('rollsOut', { date: fmtDate(note.stageEndsAt) })}
                          </p>
                        )}

                        {beta && (
                          <button
                            type="button"
                            className={beta.myStatus === 'joined' ? 'btn-ghost' : 'btn-secondary'}
                            onClick={() => setJoining(beta)}
                          >
                            {beta.myStatus === 'joined' ? tBeta('manage') : tBeta('join')}
                          </button>
                        )}
                      </article>
                    );
                  })}
                </section>
              ))}
            </div>
          )}
        </div>
      </SlideOutPanel>

      {/* One join surface for every entry point — the banner opens this same
          panel. Raised, because here it opens OVER the changelog drawer. */}
      <BetaJoinPanel beta={joining} open={joining !== null} onClose={() => setJoining(null)} zIndex={10010} />
    </>
  );
}
