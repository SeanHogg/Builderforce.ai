import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CanvasResumeEditor } from './CanvasResumeEditor';
import { activeResumeRevision, createResumeFamily, deriveResume, resumeNodePatch, type CanvasResumeFamily } from '@/lib/canvasResume';
import { importResumeSource } from '@/lib/resumeImportApi';

vi.mock('@/lib/resumeImportApi', () => ({ importResumeSource: vi.fn() }));

vi.mock('next-intl', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next-intl')>()),
  useTranslations: (await import('@/test/realCatalogTranslations')).realCatalogTranslator(
    (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
  ),
}));

describe('CanvasResumeEditor', () => {
  it('reviews file metadata before structuring and preserves the protected source reference', async () => {
    vi.mocked(importResumeSource).mockResolvedValue({
      document: { basics: { name: 'Ada Lovelace', email: 'ada@example.test' }, skills: [{ name: 'Algorithms' }] },
      sourceFileKey: '1/user/resumes/source.json', provider: 'builderforce-json', model: 'deterministic',
    });
    const onEdit = vi.fn();
    const { container } = render(<CanvasResumeEditor data={{ kind: 'resume', title: 'Resume' }} onEdit={onEdit} />);
    const file = new File(['{}'], 'ada-resume.json', { type: 'application/json' });
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });

    expect(screen.getByText('ada-resume.json')).toBeTruthy();
    expect(screen.getByText(/JSON · 1 KB/)).toBeTruthy();
    expect(onEdit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Import and structure' }));

    await waitFor(() => expect(onEdit).toHaveBeenCalledOnce());
    const family = onEdit.mock.calls[0]?.[0]?.resumeFamily as CanvasResumeFamily;
    expect(activeResumeRevision(family).document?.basics?.name).toBe('Ada Lovelace');
    expect(activeResumeRevision(family).sourceFile).toMatchObject({ key: '1/user/resumes/source.json', name: 'ada-resume.json' });
  });

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

  it('previews every template and persists default, page, orientation, and zoom settings', () => {
    const family = createResumeFamily({ title: 'Uploaded', markdown: '# Original', idFactory: () => 'original' });
    const onEdit = vi.fn();
    render(<CanvasResumeEditor data={{ kind: 'resume', title: 'Uploaded', ...resumeNodePatch(family) }} onEdit={onEdit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Browse templates' }));
    expect(screen.getByRole('region', { name: 'Résumé template gallery' }).querySelectorAll('button')).toHaveLength(12);
    fireEvent.click(screen.getByRole('button', { name: /Executive · Taupe/ }));
    let patch = onEdit.mock.calls.at(-1)?.[0] as { resumeFamily: CanvasResumeFamily };
    expect(activeResumeRevision(patch.resumeFamily).templateId).toBe('executive-taupe');

    onEdit.mockClear();
    const selected = patch.resumeFamily;
    const { unmount } = render(<CanvasResumeEditor data={{ kind: 'resume', title: 'Uploaded', ...resumeNodePatch(selected) }} onEdit={onEdit} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Set as default' }).at(-1)!);
    patch = onEdit.mock.calls.at(-1)?.[0] as { resumeFamily: CanvasResumeFamily };
    expect(patch.resumeFamily.defaultTemplateId).toBe('executive-taupe');
    unmount();
  });

  it('adds an additional canonical section without flattening the document', () => {
    const original = createResumeFamily({ title: 'Uploaded', markdown: '# Ada', document: { basics: { name: 'Ada' }, customExtension: { retained: true } }, idFactory: () => 'original' });
    const family = deriveResume(original, 'Portfolio', { idFactory: () => 'derived' });
    const onEdit = vi.fn();
    render(<CanvasResumeEditor data={{ kind: 'resume', title: 'Uploaded', ...resumeNodePatch(family) }} onEdit={onEdit} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Edit' }));
    fireEvent.click(screen.getAllByText('Projects').find((element) => element.tagName === 'SUMMARY')!);
    fireEvent.click(screen.getByRole('button', { name: 'Add project' }));
    const patch = onEdit.mock.calls.at(-1)?.[0] as { resumeFamily: CanvasResumeFamily };
    expect(activeResumeRevision(patch.resumeFamily).document?.projects).toHaveLength(1);
    expect(activeResumeRevision(patch.resumeFamily).document?.customExtension).toEqual({ retained: true });
  });

  it('detaches a selected derivative as an independent résumé family', () => {
    const original = createResumeFamily({ title: 'Uploaded', markdown: '# Ada', document: { basics: { name: 'Ada' } }, idFactory: () => 'original' });
    const family = deriveResume(original, 'Portfolio', { idFactory: () => 'derived' });
    const onDetach = vi.fn();
    render(<CanvasResumeEditor data={{ kind: 'resume', title: 'Uploaded', ...resumeNodePatch(family) }} onEdit={vi.fn()} onDetach={onDetach} />);
    fireEvent.click(screen.getByRole('button', { name: 'Detach as résumé' }));
    const detached = onDetach.mock.calls[0]?.[0]?.resumeFamily as CanvasResumeFamily;
    expect(detached.revisions).toHaveLength(1);
    expect(activeResumeRevision(detached)).toMatchObject({ kind: 'original', sourceRevisionId: null, title: 'Portfolio' });
  });

  it('renames a derived version without changing its content or source', () => {
    const original = createResumeFamily({ title: 'Uploaded', markdown: '# Ada', idFactory: () => 'original' });
    const family = deriveResume(original, 'Portfolio', { idFactory: () => 'derived' });
    const onEdit = vi.fn();
    render(<CanvasResumeEditor data={{ kind: 'resume', title: 'Uploaded', ...resumeNodePatch(family) }} onEdit={onEdit} />);
    const input = screen.getByLabelText('Current version name');
    fireEvent.change(input, { target: { value: 'Leadership résumé' } });
    fireEvent.blur(input);
    const next = onEdit.mock.calls.at(-1)?.[0]?.resumeFamily as CanvasResumeFamily;
    expect(activeResumeRevision(next)).toMatchObject({ title: 'Leadership résumé', markdown: '# Ada', sourceRevisionId: 'original' });
  });

  it('hides a section without deleting its canonical content', () => {
    const original = createResumeFamily({ title: 'Uploaded', markdown: '# Ada', document: { basics: { name: 'Ada' }, skills: [{ name: 'Algorithms' }] }, idFactory: () => 'original' });
    const family = deriveResume(original, 'Layout', { idFactory: () => 'derived' });
    const onEdit = vi.fn();
    render(<CanvasResumeEditor data={{ kind: 'resume', title: 'Uploaded', ...resumeNodePatch(family) }} onEdit={onEdit} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Edit' }));
    fireEvent.click(screen.getByText('Section order and visibility'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Skills' }));
    const patch = onEdit.mock.calls.at(-1)?.[0] as { resumeFamily: CanvasResumeFamily; markdown: string };
    expect(activeResumeRevision(patch.resumeFamily).document?.skills?.[0]?.name).toBe('Algorithms');
    expect(activeResumeRevision(patch.resumeFamily).document?.builderforceLayout?.hiddenSections).toContain('skills');
    expect(patch.markdown).not.toContain('## Skills');
  });

  it('scores a job description and sends a canonical, non-destructive Recruiter request', () => {
    const original = createResumeFamily({
      title: 'Uploaded',
      markdown: '# Ada',
      document: { basics: { name: 'Ada', summary: 'Software engineer' }, skills: [{ name: 'TypeScript', keywords: ['React'] }] },
      idFactory: () => 'original',
    });
    const family = deriveResume(original, 'Product version', { idFactory: () => 'derived' });
    const onTailor = vi.fn();
    render(<CanvasResumeEditor data={{ kind: 'resume', title: 'Uploaded', ...resumeNodePatch(family) }} onEdit={vi.fn()} onTailor={onTailor} />);

    fireEvent.click(screen.getByText('Tailor for a job'));
    fireEvent.change(screen.getByLabelText('Job description'), { target: { value: 'Seeking a TypeScript software engineer with React, Kubernetes, mentoring, and distributed systems experience.' } });
    expect(screen.getByText(/ATS keyword coverage:/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ask Recruiter to tailor' }));

    expect(onTailor).toHaveBeenCalledOnce();
    expect(onTailor.mock.calls[0]?.[0]).toContain('COMPLETE tailored JSON Resume document');
    expect(onTailor.mock.calls[0]?.[0]).toContain('"name": "Ada"');
  });

  it('persists page presentation mode and closes preview with Escape', () => {
    const original = createResumeFamily({ title: 'Uploaded', markdown: '# Ada', idFactory: () => 'original' });
    const family = deriveResume(original, 'Editable', { idFactory: () => 'derived' });
    const onEdit = vi.fn();
    render(<CanvasResumeEditor data={{ kind: 'resume', title: 'Uploaded', ...resumeNodePatch(family) }} onEdit={onEdit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Paged' }));
    expect((onEdit.mock.calls.at(-1)?.[0]?.resumeFamily as CanvasResumeFamily).previewMode).toBe('paged');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('tab', { name: 'Edit' }).getAttribute('aria-selected')).toBe('true');
  });
});
