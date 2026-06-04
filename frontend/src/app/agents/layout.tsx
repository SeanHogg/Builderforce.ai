import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'BuilderForce Agents — Self-hosted multi-agent coding workflows',
  description:
    'BuilderForce Agents is the open-source (MIT) self-hosted AI coding agent gateway. Multi-agent workflows, persistent memory, agentHost-to-agentHost mesh, and full system access — all on your hardware.',
  alternates: { canonical: '/agents' },
  openGraph: {
    title: 'BuilderForce Agents — Self-hosted multi-agent coding workflows',
    description:
      'Open-source AI coding agent gateway with multi-agent orchestration, persistent memory, and agentHost-to-agentHost mesh. Self-hosted, MIT licensed.',
    url: 'https://builderforce.ai/agents',
    type: 'website',
  },
};

export default function AgentsLayout({ children }: { children: React.ReactNode }) {
  // Chrome (sidebar + topbar + footer) is provided by the global PublicShell;
  // this layout only carries the /agents route metadata.
  return <>{children}</>;
}
