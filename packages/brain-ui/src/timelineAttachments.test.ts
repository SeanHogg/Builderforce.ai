import { describe, expect, it } from 'vitest';
import type { BrainMessage } from '@seanhogg/builderforce-brain-embedded';
import { attachmentDownloadUrl } from './timeline/MessageAttachments';
import { buildSettledTimeline, type TimelineNode } from './timelineModel';

const userTurn = (content: string, attachments: unknown[]): BrainMessage => ({
  id: 1,
  role: 'user',
  content,
  metadata: JSON.stringify({ attachments }),
  seq: 1,
  createdAt: '2026-11-21T10:00:00.000Z',
});

const userNode = (m: BrainMessage) =>
  buildSettledTimeline([m], []).find((n): n is Extract<TimelineNode, { kind: 'user' }> => n.kind === 'user')!;

describe('a user turn\'s attachments in the transcript', () => {
  it('regression: a picture carries its original link (for download) beside the stored copy it is drawn from', () => {
    const node = userNode(userTurn(
      'look at this\n\n[Attached: shot.png](https://api.example/api/brain/uploads/k1)',
      [{ key: 'k1', name: 'shot.png', type: 'image/png', imageUrl: 'data:image/png;base64,AAAA' }],
    ));
    expect(node.images).toEqual([{ url: 'data:image/png;base64,AAAA', name: 'shot.png', key: 'k1', type: 'image/png', href: 'https://api.example/api/brain/uploads/k1' }]);
    expect(node.text).toBe('look at this');
    expect(node.files).toBeUndefined();
  });

  it('a non-picture becomes a file (with its link) and its link line leaves the text', () => {
    const node = userNode(userTurn(
      'read it\n\n[Attached: spec.pdf](https://api.example/api/brain/uploads/k2)',
      [{ key: 'k2', name: 'spec.pdf', type: 'application/pdf' }],
    ));
    expect(node.files).toEqual([{ name: 'spec.pdf', key: 'k2', type: 'application/pdf', href: 'https://api.example/api/brain/uploads/k2' }]);
    expect(node.text).toBe('read it');
  });

  it('saves the account link, not a blob preview that dies with the page', () => {
    expect(attachmentDownloadUrl('blob:https://x/1', 'https://api.example/uploads/k1')).toBe('https://api.example/uploads/k1');
    expect(attachmentDownloadUrl('https://api.example/uploads/k1', 'blob:https://x/1')).toBe('https://api.example/uploads/k1');
    expect(attachmentDownloadUrl('blob:https://x/1', 'data:image/png;base64,AA')).toBe('data:image/png;base64,AA');
    expect(attachmentDownloadUrl('blob:https://x/1', undefined)).toBe('blob:https://x/1');
  });

  it('keeps a link the turn did not record', () => {
    const node = userNode(userTurn('see [Attached: other.txt](https://x/y)', []));
    expect(node.text).toBe('see [Attached: other.txt](https://x/y)');
    expect(node.images).toEqual([]);
  });
});
