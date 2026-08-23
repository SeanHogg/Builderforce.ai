'use client';

/**
 * The tax surface embedded in `/billing/tax` — two audiences, one screen.
 *
 * A payee's own W-9/W-8 ({@link TaxProfileForm}) and the manager's year-end 1099
 * report ({@link TaxReportPanel}) are different people's jobs, so each is its
 * own self-contained component with its own fetch and state; this module's only
 * job is composing them under one heading each and gating the report on the
 * `tax.viewReport` capability, matching the product's disable-not-hide rule.
 */

import { useTranslations } from 'next-intl';
import { RoleGate } from '@/components/RoleGate';
import { TaxProfileForm } from './TaxProfileForm';
import { TaxReportPanel } from './TaxReportPanel';

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-base)', border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-lg)', padding: 20, marginBottom: 20,
};

const sectionTitle: React.CSSProperties = {
  fontSize: 'var(--font-size-card-title)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 14,
};

export function TaxCenter() {
  const t = useTranslations('tax');
  return (
    <>
      <div style={cardStyle}>
        <div style={sectionTitle}>{t('profileTitle')}</div>
        <p style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.55 }}>{t('profileIntro')}</p>
        <TaxProfileForm />
      </div>

      <RoleGate capability="tax.viewReport" variant="block">
        <div style={cardStyle}>
          <div style={sectionTitle}>{t('reportTitle')}</div>
          <p style={{ fontSize: 'var(--font-size-body)', color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.55 }}>{t('reportIntro')}</p>
          <TaxReportPanel />
        </div>
      </RoleGate>
    </>
  );
}

export default TaxCenter;
