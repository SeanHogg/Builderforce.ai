import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardActContext } from '@/domains/canvas/application/CardAct';
import type { CanvasObject } from '@/domains/canvas/domain/canvasObject';
import { closeForm, publishForm, summarizeForm } from '@/lib/founderOpsApi';
import { postForm, sendForm } from '@/lib/formDistribution';
import { formActs } from './founderOpsActs';

vi.mock('@/lib/founderOpsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/founderOpsApi')>();
  return {
    ...actual,
    closeForm: vi.fn(),
    publishForm: vi.fn(),
    summarizeForm: vi.fn(),
  };
});

vi.mock('@/lib/formDistribution', () => ({
  sendForm: vi.fn(),
  postForm: vi.fn(),
}));

const t = ((key: string, values?: Record<string, unknown>) => {
  if (key === 'noticeFormPublished') return `open ${values?.url}`;
  if (key === 'noticeFormCollected') return `count ${values?.count}`;
  if (key === 'noticeFormSent') return `queued ${values?.queued}`;
  if (key === 'noticeFormPosted') return `posted ${values?.published}`;
  if (key === 'noticeFormBlocked') return `blocked ${values?.blockers}`;
  return key;
}) as CardActContext['t'];

function form(overrides: Record<string, unknown> = {}): CanvasObject {
  return {
    id: 'form-1',
    type: 'creation',
    position: { x: 0, y: 0 },
    data: {
      kind: 'form',
      title: 'Would you pay?',
      questions: [{ id: 'q1', type: 'boolean', label: 'Would you pay?', required: true }],
      ...overrides,
    },
  } as CanvasObject;
}

const board = { objects: [], create: () => form() };

describe('formActs', () => {
  beforeEach(() => {
    vi.mocked(publishForm).mockReset();
    vi.mocked(summarizeForm).mockReset();
    vi.mocked(closeForm).mockReset();
    vi.mocked(sendForm).mockReset();
    vi.mocked(postForm).mockReset();
  });

  it('publish with no questions says so and sends nothing', async () => {
    const result = await formActs.run({ object: form({ questions: [] }), action: 'publish', board, t });
    expect(publishForm).not.toHaveBeenCalled();
    expect(result.notice).toBe('noticeFormNoQuestions');
  });

  it('publish named-recipients with no rows says so and sends nothing', async () => {
    const result = await formActs.run({
      object: form({ audience: 'namedRecipients', recipients: [] }),
      action: 'publish',
      board,
      t,
    });
    expect(publishForm).not.toHaveBeenCalled();
    expect(result.notice).toBe('noticeFormNoRecipients');
  });

  it('publish stamps the join address onto the card', async () => {
    vi.mocked(publishForm).mockResolvedValue({
      questionSetId: 'qs-1',
      slug: 'hello',
      status: 'open',
      invitations: [],
    });
    const result = await formActs.run({ object: form(), action: 'publish', board, t });
    expect(publishForm).toHaveBeenCalledOnce();
    expect(result.patch).toMatchObject({ questionSetId: 'qs-1', status: 'open' });
    expect(String((result.patch as { shareUrl: string }).shareUrl)).toContain('/f/hello');
    expect(result.notice).toContain('/f/hello');
  });

  it('collect on an unpublished form says so and does not call the API', async () => {
    const result = await formActs.run({ object: form(), action: 'collect', board, t });
    expect(summarizeForm).not.toHaveBeenCalled();
    expect(result.notice).toBe('noticeFormUnpublished');
  });

  it('collect writes the tally back onto the card', async () => {
    vi.mocked(summarizeForm).mockResolvedValue({
      summary: {
        questionSetId: 'qs-1',
        slug: 'hello',
        title: 'Would you pay?',
        status: 'open',
        anonymous: false,
        audience: 'anyoneWithLink',
        submissionCount: 3,
        invitedCount: 0,
        respondedCount: 0,
      },
    });
    const result = await formActs.run({
      object: form({ questionSetId: 'qs-1' }),
      action: 'collect',
      board,
      t,
    });
    expect(result.patch).toMatchObject({ responseCount: 3, status: 'open' });
    expect(result.notice).toBe('count 3');
  });

  it('close stamps closed', async () => {
    vi.mocked(closeForm).mockResolvedValue({ ok: true });
    const result = await formActs.run({
      object: form({ questionSetId: 'qs-1' }),
      action: 'close',
      board,
      t,
    });
    expect(closeForm).toHaveBeenCalledWith('qs-1');
    expect(result.patch).toEqual({ status: 'closed' });
    expect(result.notice).toBe('noticeFormClosed');
  });

  it('send on an unpublished form says so and does not call the campaign rail', async () => {
    const result = await formActs.run({ object: form(), action: 'send', board, t });
    expect(sendForm).not.toHaveBeenCalled();
    expect(result.notice).toBe('noticeFormUnpublished');
  });

  it('send stamps the campaign id onto the card', async () => {
    vi.mocked(sendForm).mockResolvedValue({ ok: true, campaignId: 7, queued: 2 });
    const result = await formActs.run({
      object: form({ questionSetId: 'qs-1', shareUrl: 'https://x/f/hello' }),
      action: 'send',
      board,
      t,
    });
    expect(sendForm).toHaveBeenCalledOnce();
    expect(result.patch).toEqual({ campaignId: 7 });
    expect(result.notice).toBe('queued 2');
  });

  it('send surfaces campaign blockers without claiming a send', async () => {
    vi.mocked(sendForm).mockResolvedValue({ ok: false, reason: 'blocked', blockers: ['sender'], campaignId: 7 });
    const result = await formActs.run({
      object: form({ questionSetId: 'qs-1', shareUrl: 'https://x/f/hello' }),
      action: 'send',
      board,
      t,
    });
    expect(result.patch).toEqual({ campaignId: 7 });
    expect(result.notice).toBe('blocked sender');
  });

  it('post stamps the social campaign id onto the card', async () => {
    vi.mocked(postForm).mockResolvedValue({ ok: true, campaignId: 4, published: 1 });
    const result = await formActs.run({
      object: form({ questionSetId: 'qs-1', shareUrl: 'https://x/f/hello' }),
      action: 'post',
      board,
      t,
    });
    expect(postForm).toHaveBeenCalledOnce();
    expect(result.patch).toEqual({ socialCampaignId: 4 });
    expect(result.notice).toBe('posted 1');
  });
});
