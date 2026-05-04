import type { Metadata } from 'next';
import MarketingNav from './MarketingNav';
import AppFooter from '@/components/AppFooter';

export const metadata: Metadata = {
  title: 'CoderClaw — Self-hosted multi-agent coding workflows',
  description:
    'CoderClaw is the open-source (MIT) self-hosted AI coding agent gateway. Multi-agent workflows, persistent memory, claw-to-claw mesh, and full system access — all on your hardware.',
  alternates: { canonical: '/coderclaw' },
  openGraph: {
    title: 'CoderClaw — Self-hosted multi-agent coding workflows',
    description:
      'Open-source AI coding agent gateway with multi-agent orchestration, persistent memory, and claw-to-claw mesh. Self-hosted, MIT licensed.',
    url: 'https://builderforce.ai/coderclaw',
    type: 'website',
  },
};

export default function CoderClawLayout({ children }: { children: React.ReactNode }) {
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
