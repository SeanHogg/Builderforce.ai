'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BrainPanel } from '@/components/brain/BrainPanel';

/**
 * Brain Storm — the full-page Brain. It renders the exact same <BrainPanel>
 * (and therefore the same logic + UI) as the global docked drawer; only the
 * `variant` chrome differs. Deep links: ?chat= selects a chat, ?projectId=
 * pre-selects the project filter, ?prompt= auto-sends a one-shot prompt (the
 * dashboard "What should we build?" input routes here).
 */
export default function BrainstormPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const chatIdParam = searchParams.get('chat');
  const initialChatId = chatIdParam ? (Number(chatIdParam) || null) : null;
  const initialFilterProjectId = searchParams.get('projectId');

  // Capture ?prompt= exactly once on mount, then strip it from the URL so a
  // refresh doesn't replay the prompt into a fresh chat. BrainPanel auto-sends
  // it (ref-guarded) and creates+selects a chat on demand.
  const [initialPrompt] = useState(() => searchParams.get('prompt') ?? undefined);
  useEffect(() => {
    if (!searchParams.get('prompt')) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete('prompt');
    const qs = params.toString();
    router.replace(qs ? `/brainstorm?${qs}` : '/brainstorm');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <BrainPanel
      variant="page"
      initialChatId={initialChatId}
      initialFilterProjectId={initialFilterProjectId}
      initialPrompt={initialPrompt}
    />
  );
}
