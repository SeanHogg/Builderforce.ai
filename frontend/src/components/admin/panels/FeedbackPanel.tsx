'use client';

/**
 * Superadmin feedback inbox — every tenant's external requests in one queue.
 *
 * This is the product-owner end of the dogfooding loop: customers file requests
 * through the embedded widget, and they surface here. It renders through the
 * SAME <FeedbackTriage> the tenant-side queue uses; only the loader and the
 * reviewer differ (Web JWT + cross-tenant scope instead of the tenant token),
 * so approving here behaves identically to approving inside a workspace.
 */

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { adminApi } from '@/lib/adminApi';
import type { FeedbackStatus, FeedbackSubmission } from '@/lib/feedbackApi';
import { FeedbackTriage } from '@/components/feedback/FeedbackTriage';

export default function FeedbackPanel() {
  const t = useTranslations('feedback');

  const load = useCallback((status: FeedbackStatus | null) => adminApi.feedback({ status }), []);
  const review = useCallback(
    (submission: FeedbackSubmission, decision: 'approved' | 'declined') =>
      adminApi.reviewFeedback(submission.id, submission.tenantId, decision),
    [],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0 }}>{t('admin.title')}</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 4 }}>{t('admin.subtitle')}</p>
      </div>
      <FeedbackTriage load={load} review={review} showTenant />
    </div>
  );
}
