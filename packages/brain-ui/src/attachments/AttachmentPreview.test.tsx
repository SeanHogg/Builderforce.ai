import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AttachmentChips, type ComposerAttachment } from '../composer/AttachmentChips';
import { DEFAULT_COMPOSER_LABELS } from '../composer/labels';
import { MessageAttachments } from '../timeline/MessageAttachments';
import { DEFAULT_ATTACHMENT_PREVIEW_LABELS as L } from './labels';
import type { AttachmentDownload } from './types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

function mount(node: React.ReactNode): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]');
const flush = () => act(async () => { await Promise.resolve(); });

function chips(items: ComposerAttachment[], download?: AttachmentDownload, onRemove = vi.fn()) {
  return mount(<AttachmentChips items={items} onRemove={onRemove} labels={DEFAULT_COMPOSER_LABELS} previewLabels={L} download={download} />);
}

describe('the attachment preview', () => {
  it('regression: clicking a transcript image opens a labelled preview, and Escape closes it back onto the image', () => {
    const el = mount(
      <MessageAttachments
        images={[{ url: 'data:image/png;base64,AAAA', name: 'shot.png', type: 'image/png', href: 'https://api.example/api/brain/uploads/k1' }]}
        files={[]}
        labels={L}
      />,
    );
    const trigger = el.querySelector<HTMLButtonElement>('.bf-tl__image-btn')!;
    expect(trigger.getAttribute('aria-label')).toBe(`${L.open}: shot.png`);
    act(() => { trigger.focus(); trigger.click(); });
    const d = dialog()!;
    expect(d.getAttribute('aria-label')).toBe(`${L.dialog}: shot.png`);
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(d.querySelector('img')!.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    // Focus moves into the panel (its close button).
    expect(document.activeElement?.className).toContain('bf-attp__close');

    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('downloads the ORIGINAL (the turn link), not the thumbnail, through the injected port', async () => {
    const download = vi.fn<AttachmentDownload>(async () => true);
    const el = mount(
      <MessageAttachments
        images={[{ url: 'data:image/png;base64,THUMB', name: 'shot.png', href: 'https://api.example/api/brain/uploads/k1' }]}
        files={[]}
        labels={L}
        download={download}
      />,
    );
    act(() => el.querySelector<HTMLButtonElement>('.bf-tl__image-btn')!.click());
    act(() => dialog()!.querySelector<HTMLButtonElement>('.bf-attp__download')!.click());
    await flush();
    expect(download).toHaveBeenCalledTimes(1);
    expect(download.mock.calls[0]![0]).toMatchObject({ name: 'shot.png', downloadUrl: 'https://api.example/api/brain/uploads/k1' });
    expect(dialog()!.querySelector('[role="status"]')!.textContent).toBe(L.downloaded);
  });

  it('shows the host\'s sentence when the download fails, and nothing when the person cancels', async () => {
    let answer: () => Promise<boolean> = async () => { throw new Error('Sign in to download shot.png.'); };
    const download: AttachmentDownload = () => answer();
    const el = mount(<MessageAttachments images={[]} files={[{ name: 'spec.pdf', type: 'application/pdf', href: 'https://x/api/f' }]} labels={L} download={download} />);
    act(() => el.querySelector<HTMLButtonElement>('.bf-tl__file')!.click());
    // A file without a picture: the same shell, with its name and type.
    expect(dialog()!.querySelector('.bf-attp__filename')!.textContent).toBe('spec.pdf');
    expect(dialog()!.querySelector('.bf-attp__meta')!.textContent).toBe('application/pdf');
    act(() => dialog()!.querySelector<HTMLButtonElement>('.bf-attp__download')!.click());
    await flush();
    expect(dialog()!.querySelector('[role="status"]')!.textContent).toBe('Sign in to download shot.png.');
    answer = async () => false;
    act(() => dialog()!.querySelector<HTMLButtonElement>('.bf-attp__download')!.click());
    await flush();
    expect(dialog()!.querySelector('[role="status"]')!.textContent).toBe('');
  });

  it('the close button closes it; with no reachable copy, Download is disabled and says why', () => {
    const el = mount(<MessageAttachments images={[]} files={[{ name: 'notes.md' }]} labels={L} />);
    const trigger = el.querySelector<HTMLButtonElement>('.bf-tl__file')!;
    act(() => trigger.click());
    expect(dialog()!.querySelector<HTMLButtonElement>('.bf-attp__download')!.disabled).toBe(true);
    expect(dialog()!.querySelector('[role="status"]')!.textContent).toBe(L.unavailable);
    act(() => dialog()!.querySelector<HTMLButtonElement>('.bf-attp__close')!.click());
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe('the composer chips', () => {
  it('an uploading chip shows its local thumbnail and a busy spinner; the preview saves the file on this device', async () => {
    const download = vi.fn<AttachmentDownload>(async () => true);
    const el = chips([{ key: 's1', name: 'shot.png', type: 'image/png', size: 2048, localUrl: 'blob:local-1', imageUrl: 'blob:local-1', status: 'uploading' }], download);
    const chip = el.querySelector('.bf-cmp-chip')!;
    expect(chip.className).toContain('bf-cmp-chip--uploading');
    expect(chip.getAttribute('aria-busy')).toBe('true');
    expect(chip.querySelector('img')!.getAttribute('src')).toBe('blob:local-1');
    expect(chip.querySelector('[role="status"]')!.getAttribute('aria-label')).toBe(DEFAULT_COMPOSER_LABELS.attachmentUploading);

    act(() => el.querySelector<HTMLButtonElement>('.bf-cmp-chip__open')!.click());
    act(() => dialog()!.querySelector<HTMLButtonElement>('.bf-attp__download')!.click());
    await flush();
    expect(download.mock.calls[0]![0]).toMatchObject({ name: 'shot.png', downloadUrl: 'blob:local-1', size: 2048 });
  });

  it('regression: a preview open on a chip follows its upload, and closes when the chip is removed or sent', () => {
    const uploading: ComposerAttachment = { key: 'staged-1', name: 'shot.png', type: 'image/png', localUrl: 'blob:local-1', imageUrl: 'blob:local-1', status: 'uploading' };
    const el = chips([uploading]);
    act(() => el.querySelector<HTMLButtonElement>('.bf-cmp-chip__open')!.click());
    expect(dialog()).not.toBeNull();
    // The upload landed: a new key, the same file on this device — the preview stays.
    act(() => root!.render(<AttachmentChips items={[{ ...uploading, key: 'up-1', status: undefined }]} onRemove={vi.fn()} labels={DEFAULT_COMPOSER_LABELS} previewLabels={L} />));
    expect(dialog()).not.toBeNull();
    // Sent (or removed): its object URL is gone — the preview closes.
    act(() => root!.render(<AttachmentChips items={[]} onRemove={vi.fn()} labels={DEFAULT_COMPOSER_LABELS} previewLabels={L} />));
    expect(dialog()).toBeNull();
  });

  it('a failed chip shows the reason and stays removable', () => {
    const onRemove = vi.fn();
    const el = chips([{ key: 's2', name: 'big.mov', status: 'error', error: 'big.mov is too large to attach: the limit is 100 MB.' }], undefined, onRemove);
    expect(el.querySelector('.bf-cmp-chip')!.className).toContain('bf-cmp-chip--error');
    expect(el.querySelector('[role="alert"]')!.textContent).toBe('big.mov is too large to attach: the limit is 100 MB.');
    act(() => el.querySelector<HTMLButtonElement>('.bf-cmp-chip__x')!.click());
    expect(onRemove).toHaveBeenCalledWith('s2');
  });
});
