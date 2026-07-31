import { pageMetadata } from '@/lib/seo';
import AgentOpsClient from '@/components/agent-ops/AgentOpsClient';

export const runtime = 'edge';

export const metadata = pageMetadata({
  title: 'Agent Ops',
  description:
    'Operate your agent fleet: see which files agents currently hold and what they are telling each other, govern what they remember and for how long, and rehearse an agent against a ticket before it touches real work.',
  path: '/agent-ops',
});

export default function AgentOpsPage() {
  return <AgentOpsClient />;
}
