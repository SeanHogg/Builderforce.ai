'use client';

/**
 * Co-founder matching — the surface `grep -i 'co-?founder'` used to return
 * nothing for.
 *
 * ── WHY THE REASONS ARE THE PRODUCT ─────────────────────────────────────────
 * A score with no explanation is a recommendation somebody has to take on faith
 * about the most consequential professional decision they will make. So every
 * card shows WHY, including the negative reasons — two people covering the same
 * half of a company, mismatched commitment, equity expectations that cannot both
 * be met. Those are the findings. A matching product that only shows the
 * flattering half is a matching product nobody should use.
 *
 * ── AND WHY THERE IS NO "MATCH" BUTTON ──────────────────────────────────────
 * The scorer RANKS, a human ASKS, and the other human answers. Manufacturing a
 * mutual match out of a similarity score would assert an agreement neither party
 * gave — the same defect the approval gate exists to stop, in a different
 * currency.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  COFOUNDER_COMMITMENTS,
  COFOUNDER_STRENGTHS,
  cofounderMatches,
  requestIntroduction,
  saveCofounderProfile,
  type CofounderMatch,
  type CofounderProfile,
} from '@/lib/founderOpsApi';
import { FounderPaperwork } from './FounderPaperwork';
import styles from './CofounderMatching.module.css';

const EMPTY_PROFILE = {
  headline: '',
  bio: '',
  strength: 'technical',
  seeking: 'commercial',
  brings: '',
  needs: '',
  commitment: 'full-time',
  equityExpectation: '50',
  location: '',
  remoteOk: true,
  sectors: '',
  visibility: 'private',
};

type Draft = typeof EMPTY_PROFILE;

const csv = (value: string): string[] => value.split(',').map((v) => v.trim()).filter(Boolean);

export function CofounderMatching() {
  const t = useTranslations('cofounder');
  const [draft, setDraft] = useState<Draft>(EMPTY_PROFILE);
  const [profile, setProfile] = useState<CofounderProfile | null>(null);
  const [matches, setMatches] = useState<CofounderMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await cofounderMatches();
      setProfile(result.profile);
      setMatches(result.matches);
      setEditing(false);
    } catch {
      // A caller with no profile yet is the NORMAL first visit, not a failure —
      // the matcher has nothing to match against until they say who they are.
      setProfile(null);
      setEditing(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!profile) return;
    setDraft({
      headline: profile.headline,
      bio: profile.bio ?? '',
      strength: profile.strength,
      seeking: profile.seeking,
      brings: (profile.brings ?? []).join(', '),
      needs: (profile.needs ?? []).join(', '),
      commitment: profile.commitment,
      equityExpectation: profile.equityExpectation ?? '',
      location: profile.location ?? '',
      remoteOk: profile.remoteOk,
      sectors: (profile.sectors ?? []).join(', '),
      visibility: profile.visibility,
    });
  }, [profile]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveCofounderProfile({
        headline: draft.headline,
        bio: draft.bio,
        strength: draft.strength,
        seeking: draft.seeking,
        brings: csv(draft.brings),
        needs: csv(draft.needs),
        commitment: draft.commitment,
        equityExpectation: draft.equityExpectation === '' ? null : Number(draft.equityExpectation),
        location: draft.location,
        remoteOk: draft.remoteOk,
        sectors: csv(draft.sectors),
        visibility: draft.visibility,
      } as never);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{t('title')}</h1>
        <p className={styles.lede}>{t('lede')}</p>
      </header>

      {editing || !profile ? (
        <ProfileEditor
          draft={draft}
          onChange={setDraft}
          onSave={() => void save()}
          onCancel={profile ? () => setEditing(false) : null}
          saving={saving}
          t={t}
        />
      ) : (
        <section className={styles.summary}>
          <div>
            <h2 className={styles.summaryTitle}>{profile.headline}</h2>
            <p className={styles.summaryMeta}>
              {t('summaryMeta', { strength: t(`strength.${profile.strength}`), seeking: t(`strength.${profile.seeking}`), commitment: t(`commitment.${profile.commitment}`) })}
            </p>
            {/* Stated on the card, not buried in the editor: a private profile is
                invisible to discovery, and somebody wondering why nobody has
                found them should be able to see that in one glance. */}
            <p className={profile.visibility === 'public' ? styles.visible : styles.hidden}>
              {profile.visibility === 'public' ? t('visiblePublic') : t('visiblePrivate')}
            </p>
          </div>
          <button type="button" className={styles.ghost} onClick={() => setEditing(true)}>{t('edit')}</button>
        </section>
      )}

      {error && <p className={styles.error} role="alert">{error}</p>}

      {!editing && profile && (
        <section aria-labelledby="matches-heading">
          <h2 id="matches-heading" className={styles.sectionTitle}>{t('matchesTitle')}</h2>
          {loading && <p className={styles.notice}>{t('loading')}</p>}
          {!loading && matches.length === 0 && <p className={styles.notice}>{t('noMatches')}</p>}
          <ul className={styles.matchList}>
            {matches.map((match) => (
              <MatchCard key={match.profileId} match={match} onAsked={load} t={t} />
            ))}
          </ul>
        </section>
      )}

      {/* The paperwork half (FO-D5). Shown once a profile exists rather than gated on
          an ACCEPTED introduction, deliberately: a founders' agreement is just as often
          written with somebody you already know as with somebody this page found you,
          and hiding it behind a match would make the document reachable only through
          the one route that happens to be newest. */}
      {!editing && profile && <FounderPaperwork />}
    </main>
  );
}

function ProfileEditor({
  draft, onChange, onSave, onCancel, saving, t,
}: {
  draft: Draft;
  onChange: (next: Draft) => void;
  onSave: () => void;
  onCancel: (() => void) | null;
  saving: boolean;
  t: ReturnType<typeof useTranslations>;
}) {
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => onChange({ ...draft, [key]: value });

  return (
    <section className={styles.card}>
      <h2 className={styles.sectionTitle}>{t('yourProfile')}</h2>

      <label className={styles.field}>
        <span className={styles.label}>{t('headline')}</span>
        <input className={styles.input} value={draft.headline} onChange={(e) => set('headline', e.target.value)} placeholder={t('headlinePlaceholder')} />
      </label>

      <label className={styles.field}>
        <span className={styles.label}>{t('bio')}</span>
        <textarea className={styles.textarea} value={draft.bio} onChange={(e) => set('bio', e.target.value)} />
      </label>

      <div className={styles.grid}>
        <label className={styles.field}>
          <span className={styles.label}>{t('strengthLabel')}</span>
          <select className={styles.select} value={draft.strength} onChange={(e) => set('strength', e.target.value)}>
            {COFOUNDER_STRENGTHS.map((value) => <option key={value} value={value}>{t(`strength.${value}`)}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.label}>{t('seeking')}</span>
          <select className={styles.select} value={draft.seeking} onChange={(e) => set('seeking', e.target.value)}>
            {COFOUNDER_STRENGTHS.map((value) => <option key={value} value={value}>{t(`strength.${value}`)}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.label}>{t('commitmentLabel')}</span>
          <select className={styles.select} value={draft.commitment} onChange={(e) => set('commitment', e.target.value)}>
            {COFOUNDER_COMMITMENTS.map((value) => <option key={value} value={value}>{t(`commitment.${value}`)}</option>)}
          </select>
        </label>
        <label className={styles.field}>
          <span className={styles.label}>{t('equity')}</span>
          <input className={styles.input} type="number" min={0} max={100} value={draft.equityExpectation} onChange={(e) => set('equityExpectation', e.target.value)} />
          <span className={styles.help}>{t('equityHelp')}</span>
        </label>
      </div>

      <div className={styles.grid}>
        <label className={styles.field}>
          <span className={styles.label}>{t('brings')}</span>
          <input className={styles.input} value={draft.brings} onChange={(e) => set('brings', e.target.value)} placeholder={t('csvPlaceholder')} />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>{t('needs')}</span>
          <input className={styles.input} value={draft.needs} onChange={(e) => set('needs', e.target.value)} placeholder={t('csvPlaceholder')} />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>{t('sectors')}</span>
          <input className={styles.input} value={draft.sectors} onChange={(e) => set('sectors', e.target.value)} placeholder={t('csvPlaceholder')} />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>{t('location')}</span>
          <input className={styles.input} value={draft.location} onChange={(e) => set('location', e.target.value)} />
        </label>
      </div>

      <label className={styles.check}>
        <input type="checkbox" checked={draft.remoteOk} onChange={(e) => set('remoteOk', e.target.checked)} />
        {t('remoteOk')}
      </label>

      {/*
        Visibility is a CHECKBOX that is off by default and says exactly what
        turning it on does. A profile that became discoverable by default would
        publish somebody's intention to leave their job — not a default anyone
        should have to opt out of.
      */}
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={draft.visibility === 'public'}
          onChange={(e) => set('visibility', e.target.checked ? 'public' : 'private')}
        />
        {t('makeDiscoverable')}
      </label>
      <p className={styles.help}>{t('visibilityHelp')}</p>

      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={onSave} disabled={saving || !draft.headline.trim()}>
          {saving ? t('saving') : t('save')}
        </button>
        {onCancel && <button type="button" className={styles.ghost} onClick={onCancel}>{t('cancel')}</button>}
      </div>
    </section>
  );
}

function MatchCard({
  match, onAsked, t,
}: {
  match: CofounderMatch;
  onAsked: () => Promise<void>;
  t: ReturnType<typeof useTranslations>;
}) {
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      await requestIntroduction(match.profileId, message);
      await onAsked();
    } catch (askError) {
      setError(askError instanceof Error ? askError.message : t('askFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={styles.match}>
      <div className={styles.matchHead}>
        <div>
          <h3 className={styles.matchTitle}>{match.headline}</h3>
          <p className={styles.matchMeta}>
            {t('summaryMeta', { strength: t(`strength.${match.strength}`), seeking: t(`strength.${match.seeking}`), commitment: t(`commitment.${match.commitment}`) })}
            {match.location ? ` · ${match.location}` : ''}
            {match.remoteOk ? ` · ${t('remoteShort')}` : ''}
          </p>
        </div>
        {/* A meter, not a badge: the number is only meaningful next to the
            reasons below it, and a large coloured score reads as a verdict. */}
        <div className={styles.score} aria-label={t('scoreLabel', { score: match.score })}>
          <span className={styles.scoreValue}>{match.score}</span>
          <span className={styles.scoreBar}><span style={{ width: `${match.score}%` }} /></span>
        </div>
      </div>

      {match.bio && <p className={styles.matchBio}>{match.bio}</p>}

      <ul className={styles.reasons}>
        {match.reasons.map((reason, index) => (
          <li key={`${reason.dimension}-${index}`} className={reason.points < 0 ? styles.reasonAgainst : styles.reasonFor}>
            {reason.detail}
          </li>
        ))}
      </ul>

      {match.introduction ? (
        <p className={styles.notice}>
          {match.introduction.outbound
            ? t(`introOut.${match.introduction.status}`)
            : t(`introIn.${match.introduction.status}`)}
        </p>
      ) : asking ? (
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`msg-${match.profileId}`}>{t('introMessage')}</label>
          <textarea
            id={`msg-${match.profileId}`}
            className={styles.textarea}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t('introMessagePlaceholder')}
          />
          <div className={styles.actions}>
            <button type="button" className={styles.primary} disabled={busy || !message.trim()} onClick={() => void ask()}>
              {busy ? t('sending') : t('sendIntro')}
            </button>
            <button type="button" className={styles.ghost} disabled={busy} onClick={() => setAsking(false)}>{t('cancel')}</button>
          </div>
        </div>
      ) : (
        <button type="button" className={styles.ghost} onClick={() => setAsking(true)}>{t('askForIntro')}</button>
      )}

      {error && <p className={styles.error} role="alert">{error}</p>}
    </li>
  );
}
