'use client';

import { LensPage } from '@/components/insights/LensShell';
import { ChatModeLens } from '@/components/insights/ChatModeLens';

/**
 * `/insights/chat-modes` — "Conversations vs Executions": how much of what people
 * start here is a question versus work handed over, how much of that work actually
 * got dispatched to an agent, and what each mode costs.
 *
 * Client-rendered like every sibling insights page, so it prerenders statically and
 * needs no `runtime` export — the data comes from the API at request time.
 */
export default function ChatModeInsightsPage() {
  return (
    <LensPage capability="insights.llmUsage" titleKey="chatModes.title" subtitleKey="chatModes.subtitle">
      <ChatModeLens />
    </LensPage>
  );
}
