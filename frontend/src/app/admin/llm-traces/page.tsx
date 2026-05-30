/**
 * Standalone route for the superadmin LLM diagnostics view (/admin/llm-traces).
 * The actual UI is the shared LlmTracesPanel, which is also embedded as the
 * "LLM Traces" tab in the main admin page.
 */
import { LlmTracesPanel } from '../LlmTracesPanel';

export default function LlmTracesPage() {
  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: 24 }}>
      <LlmTracesPanel />
    </div>
  );
}
