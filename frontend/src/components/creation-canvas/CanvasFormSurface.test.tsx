import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { CanvasFormSurface } from './CanvasFormSurface';
import type { CreationNodeData } from './types';

vi.mock('@/lib/founderOpsApi', () => ({
  publishForm: vi.fn(),
  closeForm: vi.fn(),
  summarizeForm: vi.fn(async () => ({ summary: null })),
}));

vi.mock('@/lib/growthApi', () => ({
  growthApi: {
    listAudiences: vi.fn(async () => ({ audiences: [] })),
    createAudience: vi.fn(),
    addMembersFromCrm: vi.fn(),
  },
}));

vi.mock('@/hooks/usePolledResource', () => ({
  usePolledResource: () => ({ data: null }),
}));

const messages = {
  form: {
    regionLabel: 'Form',
    untitled: 'Untitled form',
    publish: 'Publish',
    close: 'Close',
    exit: 'Back to board',
    unpublishedHint: 'Publish to get a share link.',
    readOnlyHint: 'This form has not been published.',
    noticePublished: 'Published',
    noticeClosed: 'Closed',
    publishFailed: 'Could not publish',
    closeFailed: 'Could not close',
    shareUrl: 'Share',
    responseCount: 'Responses',
    invitedCount: 'Invited',
    respondedCount: 'Responded',
    audienceLegend: 'Who can answer',
    audience: 'Audience',
    audienceOption: {
      anyoneWithLink: 'Anyone with the link',
      workspace: 'This workspace',
      namedRecipients: 'Named people',
    },
    recipients: 'Recipients',
    marketingAudience: 'Marketing audience',
    newAudience: 'New audience',
    addFromCrm: 'Add from CRM',
    noticeCrmImported: '{added} added',
    crmFailed: 'Could not import CRM',
    required: 'required',
    'status.draft': 'Draft',
  },
};

describe('CanvasFormSurface', () => {
  it('shows Publish for an unpublished editable form and lists its questions', () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <CanvasFormSurface
          objectId="form-1"
          onExit={() => {}}
          onEdit={() => {}}
          data={{
            kind: 'form',
            title: 'Validation',
            questions: [{ id: 'q1', type: 'boolean', label: 'Would you pay?', required: true }],
          } as CreationNodeData}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId('canvas-form-surface')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Publish' })).toBeTruthy();
    expect(screen.getByText('Would you pay?')).toBeTruthy();
    expect(screen.getByText('Would you pay?').closest('li')?.textContent).toContain('boolean');
  });

  it('hides Publish when the viewer cannot edit', () => {
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <CanvasFormSurface
          objectId="form-1"
          onExit={() => {}}
          data={{ kind: 'form', title: 'Validation', questions: ['Q'] } as CreationNodeData}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    expect(screen.getByText('This form has not been published.')).toBeTruthy();
  });
});
