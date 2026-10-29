// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NodePanel } from './NodePanel';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from './labels';
import { docsFixture, fixtureSource } from './testing';
import type { FactActions, KnowledgeConfirm, KnowledgeGraphSource } from './types';

const graph = docsFixture();
const DOC = 'src:docs::lease.md';
const FACT = 'fact:note:1';

function setup(extra: Partial<KnowledgeGraphSource> = {}, props: { nodeRef?: string; confirm?: KnowledgeConfirm } = {}) {
  const source: KnowledgeGraphSource = { ...fixtureSource([graph]), ...extra };
  const onChanged = vi.fn();
  render(
    <NodePanel
      graph={graph} nodeRef={props.nodeRef ?? DOC} labels={L} source={source} confirm={props.confirm}
      onTrace={() => undefined} onSelect={() => undefined} onChanged={onChanged}
    />,
  );
  return { source, onChanged };
}

const draftBox = () => screen.getByRole('textbox') as HTMLTextAreaElement;
const write = (text: string) => fireEvent.change(draftBox(), { target: { value: text } });
const save = () => fireEvent.click(screen.getByRole('button', { name: L.saveFact }));

describe('NodePanel: what the node is', () => {
  it('names the pack in words, not by its id', () => {
    setup();
    expect(screen.getByText(L.packs.docs)).toBeTruthy();
    expect(screen.queryByText('docs')).toBeNull();
  });
});

describe('NodePanel: add fact', () => {
  it('saves a trimmed fact anchored to the node, clears the draft and tells the host', async () => {
    const rememberFact = vi.fn(async () => undefined);
    const { onChanged } = setup({ rememberFact });
    write('  Legal owns this  ');
    save();
    expect(await screen.findByText(L.factSaved)).toBeTruthy();
    expect(rememberFact).toHaveBeenCalledWith({ content: 'Legal owns this', ref: DOC, rootId: 'docs' });
    expect(draftBox().value).toBe('');
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('shows a localized error and KEEPS the draft when the write fails, then saves on retry', async () => {
    const rememberFact = vi.fn(async (): Promise<void> => undefined)
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined);
    const { onChanged } = setup({ rememberFact });
    write('Legal owns this');
    save();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(L.factSaveFailed);
    expect(draftBox().value).toBe('Legal owns this');
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.queryByText(L.factSaved)).toBeNull();

    save();
    expect(await screen.findByText(L.factSaved)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('clears the error once the person edits the draft', async () => {
    setup({ rememberFact: vi.fn(async () => { throw new Error('offline'); }) });
    write('x');
    save();
    await screen.findByRole('alert');
    write('xy');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not save an empty draft', () => {
    const rememberFact = vi.fn(async () => undefined);
    setup({ rememberFact });
    expect((screen.getByRole('button', { name: L.saveFact }) as HTMLButtonElement).disabled).toBe(true);
    expect(rememberFact).not.toHaveBeenCalled();
  });

  it('offers no add-fact form on a fact node', () => {
    setup({ rememberFact: vi.fn(async () => undefined) }, { nodeRef: FACT });
    expect(screen.queryByRole('button', { name: L.saveFact })).toBeNull();
  });
});

describe('NodePanel: delete fact', () => {
  const actionsOf = (remove: () => Promise<void>): Partial<KnowledgeGraphSource> => ({
    factActions: vi.fn(async (): Promise<FactActions | undefined> => ({ delete: remove })),
  });

  it('offers Delete only when the source says this viewer may (author or admin)', async () => {
    setup({ factActions: vi.fn(async () => undefined) }, { nodeRef: FACT });
    await waitFor(() => expect(screen.getByText('Legal owns the lease')).toBeTruthy());
    expect(screen.queryByRole('button', { name: L.deleteFact })).toBeNull();
  });

  it('deletes through the host confirmation, and does nothing when it is declined', async () => {
    const remove = vi.fn(async () => undefined);
    const confirm = vi.fn(async () => false);
    const { onChanged } = setup(actionsOf(remove), { nodeRef: FACT, confirm });
    fireEvent.click(await screen.findByRole('button', { name: L.deleteFact }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(L.deleteFactConfirm));
    expect(remove).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();

    confirm.mockResolvedValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: L.deleteFact }));
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('asks twice inline when the host has no confirmation, and Cancel disarms', async () => {
    const remove = vi.fn(async () => undefined);
    const { onChanged } = setup(actionsOf(remove), { nodeRef: FACT });
    fireEvent.click(await screen.findByRole('button', { name: L.deleteFact }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: L.cancel }));
    expect(screen.getByRole('button', { name: L.deleteFact })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: L.deleteFact }));
    fireEvent.click(screen.getByRole('button', { name: L.confirmDelete }));
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('shows a localized error when the delete fails, and the host is not told it changed', async () => {
    const remove = vi.fn(async () => { throw new Error('forbidden'); });
    const { onChanged } = setup(actionsOf(remove), { nodeRef: FACT, confirm: async () => true });
    fireEvent.click(await screen.findByRole('button', { name: L.deleteFact }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(L.factDeleteFailed);
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: L.deleteFact })).toBeTruthy();
  });
});
