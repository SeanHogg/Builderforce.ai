import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { legalDocHref } from '@/lib/legalDocs';
import { CompliancePage, LegalCallout, LegalChecklist, LegalSection } from '@/components/legal/CompliancePage';

export default async function Page() {
  const t = await getTranslations('legal.titles');
  return (
    <CompliancePage title={t('privacyRights')} currentHref="/legal/privacy-rights">
      <LegalCallout label="How to make a request">
        Email privacy@builderforce.ai or use the privacy request form in the <Link href={legalDocHref('privacy')}>Privacy Policy</Link>. We verify requests proportionately and respond within the applicable statutory period.
      </LegalCallout>

      <LegalSection title="Your privacy choices">
        <p>Depending on where you live and how BuilderForce handles your information, you may request:</p>
        <LegalChecklist items={[
          'Access or export',
          'Correction',
          'Deletion',
          'Portability',
          'Restriction or objection',
          'Opt-out',
          'Review of an automated decision',
        ]} />
        <p>Send requests to <a href="mailto:privacy@builderforce.ai">privacy@builderforce.ai</a>.</p>
      </LegalSection>

      <LegalSection title="Deletion lifecycle">
        <p>Deletion covers live systems and instructions to relevant processors. Data retained for security, fraud, tax, dispute, or legal duties is restricted.</p>
        <p>Deleted data may remain in encrypted, access-restricted backups until the documented backup cycle expires and is not restored except for disaster recovery.</p>
      </LegalSection>

      <LegalSection title="Appeals">
        <p>If we deny or limit a request, reply with <strong>“Privacy Appeal”</strong> within 45 days. A person not involved in the original decision will review it and explain the outcome and any regulator complaint route.</p>
      </LegalSection>
    </CompliancePage>
  );
}
