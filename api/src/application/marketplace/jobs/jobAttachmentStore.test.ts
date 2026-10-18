import { describe, it, expect, vi } from 'vitest';

vi.mock('../../observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));

import { deleteAttachmentBlob, putAttachment, serveAttachment } from './jobAttachmentStore';
import { reportCaughtError } from '../../observability/caughtErrorReporter';
import type { Env } from '../../../env';
import type { PostingAttachment } from '../jobPostings';

const att: PostingAttachment = { id: 'a1', key: 'job-attachments/1/2/a1.pdf', name: 'brief "v2".pdf', mime: 'application/pdf', size: 3 };

function envWith(bucket: Record<string, unknown> | undefined): Env {
  return { UPLOADS: bucket } as unknown as Env;
}

describe('jobAttachmentStore', () => {
  it('putAttachment returns null when storage is not configured', async () => {
    const file = new File(['abc'], 'x.pdf', { type: 'application/pdf' });
    expect(await putAttachment(envWith(undefined), 'p', file)).toBeNull();
  });

  it('putAttachment stores under the prefix and describes the file', async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const file = new File(['abc'], 'Brief.PDF', { type: 'application/pdf' });
    const out = await putAttachment(envWith({ put }), 'job-attachments/1/2', file);
    expect(out).toMatchObject({ name: 'Brief.PDF', mime: 'application/pdf', size: 3 });
    expect(out!.key).toBe(`job-attachments/1/2/${out!.id}.pdf`);
    expect(put).toHaveBeenCalledOnce();
  });

  it('serveAttachment 404s an id not on the authorised row', async () => {
    const res = await serveAttachment(envWith({ get: vi.fn() }), [att], 'nope');
    expect(res.status).toBe(404);
  });

  it('serveAttachment 503s without storage', async () => {
    const res = await serveAttachment(envWith(undefined), [att], 'a1');
    expect(res.status).toBe(503);
  });

  it('serveAttachment streams with private caching and a sanitised filename', async () => {
    const get = vi.fn().mockResolvedValue({ body: 'abc', httpMetadata: { contentType: 'application/octet-stream' } });
    const res = await serveAttachment(envWith({ get }), [att], 'a1');
    expect(get).toHaveBeenCalledWith(att.key);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=300');
    expect(res.headers.get('Content-Disposition')).toBe('inline; filename="brief _v2_.pdf"');
  });

  it('deleteAttachmentBlob logs (never throws) a failed delete', async () => {
    const del = vi.fn().mockRejectedValue(new Error('r2 down'));
    await expect(deleteAttachmentBlob(envWith({ delete: del }), att.key, 'deleteJobAttachment')).resolves.toBeUndefined();
    expect(reportCaughtError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ operation: 'deleteJobAttachment' }));
  });
});
