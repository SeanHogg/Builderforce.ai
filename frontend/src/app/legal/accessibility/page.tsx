import { CompliancePage, LegalCallout, LegalChecklist, LegalSection } from '@/components/legal/CompliancePage';

export default function Page() {
  return (
    <CompliancePage title="Accessibility statement" currentHref="/legal/accessibility">
      <LegalCallout label="Our accessibility target">
        BuilderForce aims to conform to WCAG 2.2 Level AA and treats accessible use as an ongoing product requirement.
      </LegalCallout>

      <LegalSection title="What we test">
        <p>Accessibility checks are included in release quality assurance across core product journeys.</p>
        <LegalChecklist items={[
          'Keyboard operation',
          'Visible focus states',
          'Landmarks, names, and roles',
          'Color contrast',
          'Zoom and responsive reflow',
          'Reduced-motion preferences',
        ]} />
      </LegalSection>

      <LegalSection title="Feedback and accommodation">
        <p>If you encounter a barrier or need content in another format, email <a href="mailto:accessibility@builderforce.ai">accessibility@builderforce.ai</a>. Include the page, task, assistive technology, and preferred response method if comfortable.</p>
        <p>We acknowledge reports promptly, prioritize blockers, and provide a reasonable alternative while remediation is underway.</p>
      </LegalSection>
    </CompliancePage>
  );
}
