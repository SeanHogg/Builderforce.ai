import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CanvasResumeEditor } from './CanvasResumeEditor';
import { activeResumeRevision, createResumeFamily, deriveResume, resumeNodePatch, type CanvasResumeFamily } from '@/lib/canvasResume';

vi.mock('next-intl', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next-intl')>()),
  useTranslations: (await import('@/test/realCatalogTranslations')).realCatalogTranslator(
    (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
  ),
}));

describe('CanvasResumeEditor', () => {
  it('edits canonical fields and regenerates the active rendered résumé', () => {
    const original = createResumeFamily({
      title: 'Uploaded',
      markdown: '# Ada',
      document: { basics: { name: 'Ada' }, work: [], education: [], skills: [] },
      idFactory: () => 'original',
    });
    const family = deriveResume(original, 'Product version', { idFactory: () => 'derived' });
    const onEdit = vi.fn();
    render(<CanvasResumeEditor data={{ kind: 'resume', title: 'Uploaded', ...resumeNodePatch(family) }} onEdit={onEdit} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ada Lovelace' } });

    const patch = onEdit.mock.calls.at(-1)?.[0] as { resumeFamily: CanvasResumeFamily; markdown: string };
    expect(activeResumeRevision(patch.resumeFamily).document?.basics?.name).toBe('Ada Lovelace');
    expect(patch.markdown).toContain('# Ada Lovelace');
  });

  it('keeps the protected original edit tab disabled', () => {
    const family = createResumeFamily({ title: 'Uploaded', markdown: '# Original', idFactory: () => 'original' });
    render(<CanvasResumeEditor data={{ kind: 'resume', title: 'Uploaded', ...resumeNodePatch(family) }} onEdit={vi.fn()} />);
    expect(screen.getByRole('tab', { name: 'Edit' })).toBeDisabled();
    expect(screen.getByText('Protected original')).toBeTruthy();
  });

  it('adds an additional canonical section without flattening the document', () => {
    const original = createResumeFamily({ title: 'Uploaded', markdown: '# Ada', document: { basics: { name: 'Ada' }, customExtension: { retained: true } }, idFactory: () => 'original' });
    const family = deriveResume(original, 'Portfolio', { idFactory: () => 'derived' });
    const onEdit = vi.fn();
    render(<CanvasResumeEditor data={{ kind: 'resume', title: 'Uploaded', ...resumeNodePatch(family) }} onEdit={onEdit} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Edit' }));
    fireEvent.click(screen.getByText('Projects'));
    fireEvent.click(screen.getByRole('button', { name: 'Add project' }));
    const patch = onEdit.mock.calls.at(-1)?.[0] as { resumeFamily: CanvasResumeFamily };
    expect(activeResumeRevision(patch.resumeFamily).document?.projects).toHaveLength(1);
    expect(activeResumeRevision(patch.resumeFamily).document?.customExtension).toEqual({ retained: true });
  });
});
