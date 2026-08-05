import { CompliancePage, LegalCallout, LegalChecklist, LegalSection } from '@/components/legal/CompliancePage';

export default function Page() {
  return (
    <CompliancePage title="Customer data processing addendum" currentHref="/legal/dpa">
      <LegalCallout label="When this DPA applies">
        This DPA forms part of the customer agreement when Fix Faster LLC processes Customer Personal Data on the customer&apos;s behalf.
      </LegalCallout>

      <LegalSection title="Processing commitments">
        <p>BuilderForce processes data only on documented instructions to provide, secure, support, and improve the service.</p>
        <LegalChecklist items={[
          'Confidentiality obligations',
          'Technical and organizational safeguards',
          'Assistance with data-subject requests',
          'Impact-assessment and incident assistance',
          'Deletion or return at termination',
          'Audit information',
        ]} />
        <p>Lawful retention and isolated backup-expiry requirements continue to apply.</p>
      </LegalSection>

      <LegalSection title="Subprocessors and transfers">
        <p>BuilderForce remains responsible for subprocessor obligations, publishes its list, gives notice of material changes, and uses applicable Standard Contractual Clauses, the UK Addendum, or another lawful transfer mechanism where required.</p>
      </LegalSection>

      <LegalSection title="Instructions and execution">
        <p>The agreement and customer configuration are the documented instructions. Contact <a href="mailto:privacy@builderforce.ai">privacy@builderforce.ai</a> to execute this DPA or obtain SCC modules and security exhibits applicable to your deployment.</p>
      </LegalSection>
    </CompliancePage>
  );
}
