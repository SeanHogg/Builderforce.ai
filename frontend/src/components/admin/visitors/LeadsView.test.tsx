import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LeadsView } from './LeadsView';
import type { AdminGuestSession, AdminGuestSessionsPage } from '@/lib/adminApi';

/**
 * S5 surfaces a derived score and the visit the last prompt was typed in.
 * Copy is the passthrough key under the global next-intl mock (src/test/setup.ts).
 */

vi.mock('@/components/visitors/GuestSessionCopyButton', () => ({
  GuestSessionCopyButton: () => <button type="button">copy</button>,
}));

type LeadRow = AdminGuestSession & {
  score?: number;
  visitCount?: number;
  lastVisitId?: string | null;
};

const session = (over: Partial<LeadRow> = {}): LeadRow => ({
  id: 's-1',
  visitorId: 'vis-hot',
  guestChatCount: 3,
  guestChatTokens: 1200,
  toolRuns: 1,
  landingPath: '/pricing',
  referrer: null,
  converted: true,
  convertedUserId: 'u-1',
  convertedEmail: 'ada@example.com',
  convertedAt: '2026-10-10T09:00:00.000Z',
  firstSeenAt: '2026-10-01T09:00:00.000Z',
  lastSeenAt: '2026-10-11T11:00:00.000Z',
  isPaid: false,
  promptCount: 2,
  firstPrompt: 'Build me a pricing page',
  lastPrompt: 'Build me a pricing page with three tiers?',
  lastPromptAt: '2026-10-11T10:00:00.000Z',
  lastSurface: 'landing',
  score: 72,
  visitCount: 3,
  lastVisitId: 'visit-abc12345',
  ...over,
});

const page = (sessions: LeadRow[]): AdminGuestSessionsPage => ({
  summary: {
    sessions: sessions.length,
    sessionsWithPrompt: sessions.filter((s) => s.promptCount > 0).length,
    prompts: sessions.reduce((n, s) => n + s.promptCount, 0),
    registered: sessions.filter((s) => s.converted).length,
    paid: sessions.filter((s) => s.isPaid).length,
    conversionPct: 50,
  },
  sessions,
});

describe('LeadsView', () => {
  it('names the empty recording gap', () => {
    render(
      <LeadsView data={page([])} loading={false} error="" onOpenLead={() => {}} />,
    );
    expect(screen.getByText('admin.sessions.empty')).toBeInTheDocument();
  });

  it('shows the derived score, last visit, and when the visitor signed up', () => {
    render(
      <LeadsView data={page([session()])} loading={false} error="" onOpenLead={() => {}} />,
    );
    expect(screen.getByText('vis-hot')).toBeInTheDocument();
    expect(screen.getByText('72')).toBeInTheDocument();
    expect(screen.getByText('visit-abc12345')).toBeInTheDocument();
    expect(screen.getByText('admin.sessions.registered')).toBeInTheDocument();
    expect(screen.getByText(/admin.sessions.metricSignedUpAt/)).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
  });

  it('still renders a payload that has not grown the extra fields', () => {
    const legacy = session();
    delete legacy.score;
    delete legacy.visitCount;
    delete legacy.lastVisitId;
    render(
      <LeadsView data={page([legacy])} loading={false} error="" onOpenLead={() => {}} />,
    );
    expect(screen.getByText('vis-hot')).toBeInTheDocument();
    expect(screen.getByTitle('admin.sessions.engagement')).toHaveTextContent('0');
    expect(screen.queryByText('visit-abc12345')).not.toBeInTheDocument();
  });

  it('opens the lead from the visitor id', () => {
    const onOpenLead = vi.fn();
    const row = session();
    render(
      <LeadsView data={page([row])} loading={false} error="" onOpenLead={onOpenLead} />,
    );
    fireEvent.click(screen.getByText('vis-hot'));
    expect(onOpenLead).toHaveBeenCalledWith(row);
  });

  it('sorts engagement by score so the hottest lead is first', () => {
    const cold = session({ id: 's-cold', visitorId: 'vis-cold', score: 10, lastSeenAt: '2026-10-11T12:00:00.000Z' });
    const hot = session({ id: 's-hot', visitorId: 'vis-hot', score: 90, lastSeenAt: '2026-10-11T10:00:00.000Z' });
    render(
      <LeadsView data={page([cold, hot])} loading={false} error="" onOpenLead={() => {}} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'admin.sessions.sortBy admin.sessions.engagement' }));
    const ids = screen.getAllByText(/^vis-/).map((el) => el.textContent);
    expect(ids[0]).toBe('vis-hot');
    expect(ids[1]).toBe('vis-cold');
  });
});
