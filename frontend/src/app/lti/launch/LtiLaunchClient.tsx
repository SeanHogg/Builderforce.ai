'use client';

/**
 * Where a launch from a connected LMS lands when it does NOT open a board.
 *
 * A successful staff launch never reaches this page: `POST /api/lti/launch`
 * establishes a session and redirects straight to the bound course board. This is
 * the other half — the launch that was verified and then declined, which has
 * exactly three causes and each one needs a different thing from the reader:
 *
 *   · a LEARNER launched the course-navigation link. Not an error: the cohort
 *     board carries the whole roster and every mark on it, so opening it for a
 *     student would disclose their classmates' grades. They are told their
 *     instructor distributes their own copy.
 *   · the LMS released no email address, so there is nobody to sign in. Their
 *     administrator has to set the tool's privacy level to public.
 *   · the registration is not bound to a workspace.
 *
 * The API composes the sentence, because only it knows which happened; this page
 * renders it. Inventing a friendlier local message would mean the page and the
 * server disagree about why somebody was turned away.
 */

import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import PageContainer from '@/components/PageContainer';

export default function LtiLaunchClient() {
  const t = useTranslations('ltiLaunch');
  const reason = useSearchParams().get('error');

  return (
    <PageContainer width="readable" style={{ padding: '48px 24px' }}>
      <div
        style={{
          background: 'var(--bg-base)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          padding: 'clamp(20px, 5vw, 32px)',
          maxWidth: 640,
          margin: '0 auto',
        }}
      >
        <h1 style={{ fontSize: 'var(--font-size-page-title)', fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 10px' }}>
          {t('title')}
        </h1>
        <p style={{ fontSize: 'var(--font-size-card-title)', lineHeight: 1.6, color: 'var(--text-secondary)', margin: '0 0 20px' }}>
          {reason || t('genericReason')}
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link
            href="/dashboard"
            style={{
              padding: '9px 16px',
              fontSize: 'var(--font-size-body)',
              fontWeight: 600,
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              textDecoration: 'none',
            }}
          >
            {t('openWorkspace')}
          </Link>
          <Link
            href="/security?sub=identity"
            style={{
              padding: '9px 16px',
              fontSize: 'var(--font-size-body)',
              fontWeight: 600,
              borderRadius: 'var(--radius-md)',
              background: 'transparent',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-subtle)',
              textDecoration: 'none',
            }}
          >
            {t('reviewRegistration')}
          </Link>
        </div>
      </div>
    </PageContainer>
  );
}
