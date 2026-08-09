import { getTranslations } from 'next-intl/server';
import { CompliancePage, LegalCallout, LegalChecklist, LegalSection } from '@/components/legal/CompliancePage';

export default async function Page() {
  const t = await getTranslations('legal.titles');
  return (
    <CompliancePage title={t('cookies')} currentHref="/legal/cookies">
      <LegalCallout label="Privacy-protective defaults">
        Optional analytics stays off until you opt in. BuilderForce does not use targeted-advertising cookies or sell personal information.
      </LegalCallout>

      <LegalSection title="Default choices">
        <p>Necessary local storage and cookies support the features required to operate and remember your experience.</p>
        <LegalChecklist items={[
          'Authentication and security',
          'Language preferences',
          'Theme preferences',
          'Saved work',
        ]} />
        <p>BuilderForce does not sell or share personal information for cross-context behavioral advertising.</p>
      </LegalSection>

      <LegalSection title="Global Privacy Control">
        <p>When your browser sends Global Privacy Control, BuilderForce treats it as an opt-out and disables optional analytics and marketing choices. You can reopen Cookie preferences in the footer at any time.</p>
      </LegalSection>

      <LegalSection title="Current analytics provider">
        <p>Google Tag Manager is loaded only after affirmative analytics consent. Consent withdrawal prevents future loading; browser storage can be cleared to remove the saved choice.</p>
      </LegalSection>
    </CompliancePage>
  );
}
