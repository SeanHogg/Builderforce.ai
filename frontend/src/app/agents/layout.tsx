import type { Metadata } from 'next';
import MarketingNav from './MarketingNav';
import AppFooter from '@/components/AppFooter';

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
  return (
    <div className="cc-shell">
      <MarketingNav />
      <main className="cc-main">{children}</main>
      <AppFooter />
      <style>{`
        .cc-shell {
          position: relative;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          background: var(--bg-deep);
          color: var(--text-primary);
        }
        .cc-main {
          flex: 1;
          width: 100%;
        }
      `}</style>
    </div>
  );
}
