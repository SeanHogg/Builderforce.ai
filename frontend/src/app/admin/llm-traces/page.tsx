/**
 * Standalone route for the superadmin LLM diagnostics view (/admin/llm-traces).
 * The actual UI is the shared LlmTracesPanel, which is also embedded as the
 * "LLM Traces" tab in the main admin page.
 */
import { LlmTracesPanel } from '../LlmTracesPanel';
import PageContainer from '@/components/PageContainer';

export default function LlmTracesPage() {
  return (
    <PageContainer style={{ padding: 24 }}>
      <LlmTracesPanel />
    </PageContainer>
  );
}
