'use client';

import { useSearchParams } from 'next/navigation';
import { BrainPanel } from '@/components/brain/BrainPanel';

/**
 * Brain Storm — the full-page Brain. It renders the exact same <BrainPanel>
 * (and therefore the same logic + UI) as the global docked drawer; only the
 * `variant` chrome differs. Deep links: ?chat= selects a chat, ?projectId=
 * pre-selects the project filter.
 */
export default function BrainstormPage() {
  const searchParams = useSearchParams();
  const chatIdParam = searchParams.get('chat');
  const initialChatId = chatIdParam ? (Number(chatIdParam) || null) : null;
  const initialFilterProjectId = searchParams.get('projectId');

  return (
    <BrainPanel
      variant="page"
      initialChatId={initialChatId}
      initialFilterProjectId={initialFilterProjectId}
    />
  );
}
