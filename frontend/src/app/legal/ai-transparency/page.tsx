import { CompliancePage, LegalCallout, LegalChecklist, LegalSection } from '@/components/legal/CompliancePage';

export default function Page() {
  return (
    <CompliancePage title="AI transparency and human review" currentHref="/legal/ai-transparency">
      <LegalCallout label="Humans stay in control">
        AI output may be inaccurate. BuilderForce exposes agent activity and approval prompts so people can review work before relying on it.
      </LegalCallout>

      <LegalSection title="How AI is used">
        <p>BuilderForce is an agentic platform. Users interact with AI systems that can generate text, code, designs, recommendations, and proposed actions.</p>
        <LegalChecklist items={[
          'Agent identity is displayed',
          'Tool calls are visible',
          'Source context can be inspected',
          'External actions use approval controls',
        ]} />
        <p>Users own their inputs, chats, and ideas as described in the Terms; BuilderForce does not sell them.</p>
      </LegalSection>

      <LegalSection title="Control and explanations">
        <p>Agent identity, activity, tool calls, source context, and approval prompts are displayed in the product. Actions that mutate external or customer state are approval-gated unless an authorized user deliberately enables auto-approval.</p>
        <p>Customers should classify intended uses before deployment.</p>
      </LegalSection>

      <LegalSection title="Consequential decisions">
        <p>BuilderForce is not intended to make final decisions about employment, housing, credit, education admission, insurance, healthcare, legal services, or access to essential services without qualified human review.</p>
        <p>Contact <a href="mailto:privacy@builderforce.ai">privacy@builderforce.ai</a> to request an explanation, contest an AI-assisted outcome, or obtain human review.</p>
      </LegalSection>
    </CompliancePage>
  );
}
