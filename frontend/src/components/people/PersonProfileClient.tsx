'use client';

/**
 * A teammate's profile page (`/people/<userId>`): who they are, their role in this
 * workspace, their personality (the same read-only summary the board hovercard uses)
 * and a summary of the work assigned to them. Reads `GET /api/people/:userId`, which
 * is tenant-scoped - a person outside the workspace is a "not found", never a leak.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import PageContainer from '@/components/PageContainer';
import { useRoleText } from '@/lib/useRoleText';
import PersonalitySummary from '@/components/PersonalitySummary';
import { SectionEmpty, SectionError, SectionLoading } from '@/components/ui/SectionState';
import { StatTile } from '@/components/ui/StatTile';
import { peopleApi, type PersonProfileDto } from '@/lib/peopleApi';

export default function PersonProfileClient({ userId }: { userId: string }) {
  const t = useTranslations('personProfile');
  const roleText = useRoleText();
  const [person, setPerson] = useState<PersonProfileDto | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let live = true;
    setPerson(null);
    setError(null);
    peopleApi.get(userId)
      .then((p) => { if (live) setPerson(p); })
      .catch((e) => { if (live) setError(e); });
    return () => { live = false; };
  }, [userId]);

  return (
    <PageContainer width="readable" style={{ padding: 'clamp(16px, 4vw, 40px)' }}>
      {error != null ? <SectionError error={error} /> : !person ? <SectionLoading label={t('loading')} /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, minWidth: 0 }}>
          <header style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            {person.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={person.avatarUrl}
                alt=""
                width={64}
                height={64}
                style={{ borderRadius: 'var(--radius-full)', objectFit: 'cover', flexShrink: 0 }}
              />
            ) : (
              <span
                aria-hidden
                style={{
                  width: 64, height: 64, borderRadius: 'var(--radius-full)', flexShrink: 0,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--surface-2)', color: 'var(--text-strong)', fontSize: 24, fontWeight: 700,
                }}
              >
                {person.displayName.slice(0, 1).toUpperCase()}
              </span>
            )}
            <div style={{ minWidth: 0 }}>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>
                {person.displayName}
              </h1>
              <div style={{ color: 'var(--muted)', fontSize: 'var(--font-size-small)' }}>
                {person.roles.map(roleText.label).join(' · ')}
              </div>
            </div>
          </header>

          <section aria-label={t('work')}>
            <h2 style={{ margin: '0 0 10px', fontSize: 'var(--font-size-card-title)', color: 'var(--text-strong)' }}>{t('work')}</h2>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <StatTile label={t('open')} value={String(person.work.openAssigned)} />
              <StatTile label={t('recent')} value={String(person.work.recentAssigned)} />
              <StatTile label={t('completed')} value={String(person.work.completed)} />
            </div>
          </section>

          {person.psychometric ? (
            <PersonalitySummary profile={person.psychometric} />
          ) : (
            <SectionEmpty message={t('noPersonality')} />
          )}
        </div>
      )}
    </PageContainer>
  );
}
