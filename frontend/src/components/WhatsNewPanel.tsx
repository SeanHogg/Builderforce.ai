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
} from './releaseNotes/ReleaseNoteParts';
import { useBetaPrograms } from '@/lib/betaPrograms';
import { fetchReleaseNotes, type BetaProgram, type ReleaseNote } from '@/lib/releaseNotesApi';

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

export default function WhatsNewPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('whatsNew');
  const tBeta = useTranslations('beta');
  const fmtDate = useReleaseNoteDate();
  const { betas } = useBetaPrograms();
  const [notes, setNotes] = useState<ReleaseNote[] | null>(null);
  const [error, setError] = useState(false);
  const [joining, setJoining] = useState<BetaProgram | null>(null);

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

  return (
    <>
      <SlideOutPanel open={open} onClose={onClose} title={t('title')} width="wide">
        {error ? (
          <p style={{ color: 'var(--text-secondary)', padding: '8px 0' }}>{t('error')}</p>
        ) : notes === null ? (
          <p style={{ color: 'var(--text-secondary)', padding: '8px 0' }}>{t('loading')}</p>
        ) : notes.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', padding: '8px 0' }}>{t('empty')}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {notes.map((note) => {
              const beta = joinable.get(note.id) ?? null;
              return (
                <article
                  key={note.id}
                  style={{
                    borderBottom: '1px solid var(--border)',
                    paddingBottom: 16,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                    <CategoryBadge category={note.category} />
                    {/* 'live' is the resting state — badging every shipped note
                        with it would say nothing. Stages that mean something to a
                        reader (in development, in beta, sunsetting) are shown. */}
                    {note.stage !== 'live' && <StageBadge stage={note.stage} />}
                    <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono, monospace)' }}>
                      v{note.version}
                    </span>
                    {note.publishedAt && (
                      <span style={{ fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
                        {fmtDate(note.publishedAt)}
                      </span>
                    )}
                  </div>
                  <h3 style={{ margin: '0 0 6px', fontSize: 'var(--font-size-card-title)', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {note.title}
                  </h3>
                  <ReleaseNoteBody body={note.body} />

                  {note.stageEndsAt && isBetaStage(note.stage) && (
                    <p style={{ margin: '0 0 8px', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>
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
          </div>
        )}
      </SlideOutPanel>

      {/* One join surface for every entry point — the banner opens this same
          panel. Raised, because here it opens OVER the changelog drawer. */}
      <BetaJoinPanel beta={joining} open={joining !== null} onClose={() => setJoining(null)} zIndex={10010} />
    </>
  );
}
