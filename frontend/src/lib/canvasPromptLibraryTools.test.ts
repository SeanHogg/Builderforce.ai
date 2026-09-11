/**
 * The prompt library on the canvas, asserted directly.
 *
 * The API client is mocked. The board is a fake that applies patches through the REAL
 * `sanitizeCreationObjectPatch`, because that filter is what the canvas context applies
 * and it is where this gap hid: `prompt.entryId` and `prompt.versions` were `derived`,
 * so a patch carrying them was silently dropped and no card could ever be bound to its
 * library row. A fake that skipped the filter would pass while the product failed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/messages/en.json';
import zh from '@/i18n/messages/zh.json';
import es from '@/i18n/messages/es.json';
import fr from '@/i18n/messages/fr.json';
import de from '@/i18n/messages/de.json';
import type { PromptEntry } from './builderforceApi';
import type { CanvasFounderOpsContext } from './canvasFounderOpsTools';
import { creationObjectMutableFields, sanitizeCreationObjectPatch } from '@/components/creation-canvas/creationObjectRegistry';
import { invalidateClientCache } from '@/infrastructure/http/readThrough';
import { ACCOUNT_REQUIRED_CANVAS_TOOLS } from '@builderforce/creation-canvas-contract';
import { DATA_SCIENCE_OBJECT_SPECS } from './dataScienceObjects';
import './specObjectSets';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  addVersion: vi.fn(),
}));

vi.mock('./builderforceApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./builderforceApi')>()),
  promptLibraryApi: api,
}));

// Imported after the mock is declared (vi.mock is hoisted either way; this keeps the
// reading order honest).
import {
  canvasPromptLibraryActions,
  lineDelta,
  promptCardFieldsFrom,
  promptHistoryForModel,
  promptMatchesQuery,
  promptVariablesFrom,
  PROMPT_LIBRARY_CACHE_PREFIX,
} from './canvasPromptLibraryTools';

const AT = '2026-09-10T08:15:00.000Z';

const entry = (over: Partial<PromptEntry> = {}): PromptEntry => ({
  id: 'p-1',
  slug: 'support-triage',
  title: 'Support triage',
  description: 'Routes inbound tickets',
  category: 'support',
  tags: ['triage', 'email'],
  authorName: null,
  currentVersion: 2,
  usageCount: 14,
  starCount: 3,
  isFeatured: false,
  updatedAt: '2026-09-09T10:00:00.000Z',
  visibility: 'private',
  authorUserId: 'u-1',
  versions: [
    { id: 'v1', version: 1, body: 'Classify {{ticket}}.', variables: [{ name: 'ticket', description: 'The raw email' }], model: null, notes: 'First cut', createdAt: '2026-09-01T09:00:00.000Z' },
    { id: 'v2', version: 2, body: 'Classify {{ticket}} into one queue.\nAnswer with the queue name only.', variables: [{ name: 'ticket', description: 'The raw email' }], model: null, notes: 'Force a single label', createdAt: '2026-09-05T09:00:00.000Z' },
  ],
  ...over,
});

type Obj = { id: string; kind: string; title: string; data: Record<string, unknown> };
type Result = Record<string, unknown> & { error?: string; instruction?: string };

function board(options: { hasTenant?: boolean; canEdit?: boolean; objects?: Obj[] } = {}) {
  const objects: Obj[] = options.objects ?? [];
  const labels: string[] = [];
  let next = 0;
  const ctx: CanvasFounderOpsContext = {
    sessionId: `session-${Math.random()}`,
    hasTenant: options.hasTenant ?? true,
    canEdit: options.canEdit ?? true,
    objects: () => objects,
    addObject: (kind, fields) => {
      const safe = sanitizeCreationObjectPatch(kind as 'prompt', fields) as Record<string, unknown>;
      const id = `obj-${++next}`;
      objects.push({ id, kind, title: String(safe.title ?? ''), data: safe });
      labels.push(String(fields.title ?? kind));
      return { objectId: id };
    },
    updateObject: (objectId, patch, label) => {
      const target = objects.find((object) => object.id === objectId);
      if (!target) throw new Error(`no object ${objectId}`);
      target.data = { ...target.data, ...(sanitizeCreationObjectPatch(target.kind as 'prompt', patch) as Record<string, unknown>) };
      labels.push(label);
    },
  };
  const actions = canvasPromptLibraryActions(ctx);
  const run = async (name: string, args: Record<string, unknown> = {}): Promise<Result> => {
    const action = actions.find((candidate) => candidate.name === name);
    if (!action) throw new Error(`no tool ${name}`);
    return (await action.run(args)) as Result;
  };
  return { ctx, objects, labels, run, actions };
}

const promptCard = (data: Record<string, unknown>, id = 'card-1'): Obj => ({ id, kind: 'prompt', title: 'Support triage', data: { title: 'Support triage', ...data } });

beforeEach(() => {
  invalidateClientCache(PROMPT_LIBRARY_CACHE_PREFIX);
  api.list.mockReset();
  api.get.mockReset();
  api.create.mockReset();
  api.addVersion.mockReset();
});

describe('the prompt kind can hold its library binding (registry data)', () => {
  const spec = DATA_SCIENCE_OBJECT_SPECS.find((candidate) => candidate.kind === 'prompt');

  it('declares entryId and versions as bookkeeping, not derived', () => {
    for (const name of ['entryId', 'versions']) {
      const field = spec?.fields.find((candidate) => candidate.name === name);
      expect(field?.bookkeeping, `${name} is bookkeeping`).toBe(true);
      // `derived` keeps a field out of `specMutableFields`, and therefore off the board.
      expect(field?.derived, `${name} must not be derived`).toBeUndefined();
    }
  });

  it('every field a read writes reaches the card through the real filter', () => {
    const fields = promptCardFieldsFrom(entry(), AT);
    const mutable = new Set(creationObjectMutableFields('prompt'));
    for (const key of Object.keys(fields)) {
      expect(mutable, `prompt.${key} must be writable for the read to reach the board`).toContain(key);
    }
    expect(sanitizeCreationObjectPatch('prompt', fields)).toEqual(fields);
  });

  it('labels the new notes column in all five catalogs', () => {
    for (const catalog of [en, zh, es, fr, de]) {
      expect(catalog.creationCanvas.dataScience.column.notes).toBeTruthy();
    }
  });
});

describe('the projection', () => {
  it('puts the current version on the card with the history newest first', () => {
    const fields = promptCardFieldsFrom(entry(), AT);
    expect(fields.entryId).toBe('p-1');
    expect(fields.activeVersion).toBe(2);
    expect(fields.body).toContain('into one queue');
    expect(fields.variables).toEqual(['ticket']);
    expect((fields.versions as Array<{ version: number }>).map((row) => row.version)).toEqual([2, 1]);
    expect(String(fields.summary)).toContain('2026-09-10 08:15');
  });

  it('never invents a score for a version', () => {
    const rows = promptCardFieldsFrom(entry(), AT).versions as Array<Record<string, unknown>>;
    for (const row of rows) expect(row).not.toHaveProperty('evalScore');
  });

  it('keeps an unsaved draft rather than reverting it', () => {
    const fields = promptCardFieldsFrom(entry(), AT, { keepDraft: true });
    expect(fields).not.toHaveProperty('body');
    expect(fields).not.toHaveProperty('variables');
    expect(String(fields.status)).toContain('Unsaved');
  });

  it('returns recent bodies to the model, bounded', () => {
    const long = 'x'.repeat(5000);
    const history = promptHistoryForModel(entry({ versions: [{ id: 'v1', version: 1, body: long, variables: [], model: null, notes: null, createdAt: AT }] }));
    expect(history[0]!.body).toHaveLength(4000);
    expect(history[0]!.truncated).toBe(true);
  });

  it('keeps variable documentation that survives, and falls back to placeholders', () => {
    const previous = [{ name: 'ticket', description: 'The raw email' }];
    expect(promptVariablesFrom(['ticket', 'tone'], '', previous)).toEqual([{ name: 'ticket', description: 'The raw email' }, { name: 'tone' }]);
    expect(promptVariablesFrom([], 'Hi {{ name }}, re {{order_id}} and {{name}}')).toEqual([{ name: 'name' }, { name: 'order_id' }]);
    expect(promptVariablesFrom(['{{city}}', 'bad name!'], '')).toEqual([{ name: 'city' }]);
  });

  it('measures an edit as lines added and removed', () => {
    expect(lineDelta('a\nb\nc', 'a\nc\nd\ne')).toEqual({ added: 2, removed: 1 });
    expect(lineDelta('same', 'same')).toEqual({ added: 0, removed: 0 });
  });

  it('matches a query on every word across title, tags and category', () => {
    expect(promptMatchesQuery(entry(), 'triage email')).toBe(true);
    expect(promptMatchesQuery(entry(), 'triage sales')).toBe(false);
  });
});

describe('canvas_read_prompt', () => {
  it('refuses an anonymous board without calling the library', async () => {
    const { run } = board({ hasTenant: false });
    const result = await run('canvas_read_prompt');
    expect(result.error).toContain('signed-in');
    expect(api.list).not.toHaveBeenCalled();
  });

  it('lists the library filtered by query, through the read-through cache', async () => {
    api.list.mockResolvedValue([entry(), entry({ id: 'p-2', title: 'Sales follow-up', tags: ['sales'], category: 'sales' })]);
    const { run } = board();
    const result = await run('canvas_read_prompt', { query: 'sales' });
    expect(result.promptsFound).toBe(true);
    expect((result.prompts as Array<{ entryId: string }>).map((prompt) => prompt.entryId)).toEqual(['p-2']);
    await run('canvas_read_prompt');
    expect(api.list).toHaveBeenCalledTimes(1);
  });

  it('says the library is empty instead of drawing an empty card', async () => {
    api.list.mockResolvedValue([]);
    const { run, objects } = board();
    const result = await run('canvas_read_prompt');
    expect(result.promptsFound).toBe(false);
    expect(result.instruction).toContain('canvas_save_prompt_version');
    expect(objects).toHaveLength(0);
  });

  it('places an entry as a bound prompt card, with the history for the model', async () => {
    api.get.mockResolvedValue(entry());
    const { run, objects } = board();
    const result = await run('canvas_read_prompt', { entryId: 'p-1' });
    expect(result.ok).toBe(true);
    expect(objects).toHaveLength(1);
    expect(objects[0]!.kind).toBe('prompt');
    expect(objects[0]!.data.entryId).toBe('p-1');
    expect(objects[0]!.data.activeVersion).toBe(2);
    expect((objects[0]!.data.versions as unknown[]).length).toBe(2);
    expect((result.versions as Array<{ body?: string }>)[0]!.body).toContain('into one queue');
  });

  it('refreshes the card bound to the entry instead of adding a second one', async () => {
    api.get.mockResolvedValue(entry());
    const current = entry().versions![1]!.body;
    const { run, objects } = board({ objects: [promptCard({ entryId: 'p-1', body: current })] });
    await run('canvas_read_prompt', { entryId: 'p-1' });
    expect(objects).toHaveLength(1);
    expect(objects[0]!.data.activeVersion).toBe(2);
  });

  it('keeps unsaved edits on a bound card and says so', async () => {
    api.get.mockResolvedValue(entry());
    const { run, objects } = board({ objects: [promptCard({ entryId: 'p-1', body: 'My new draft' })] });
    const result = await run('canvas_read_prompt', { entryId: 'p-1' });
    expect(result.unsavedDraft).toBe(true);
    expect(objects[0]!.data.body).toBe('My new draft');
  });

  it('will not place a card for a role that cannot edit', async () => {
    const { run } = board({ canEdit: false });
    const result = await run('canvas_read_prompt', { entryId: 'p-1' });
    expect(result.error).toContain('cannot edit');
    expect(api.get).not.toHaveBeenCalled();
  });
});

describe('canvas_save_prompt_version', () => {
  it('is refused for a role that cannot edit', async () => {
    const { run } = board({ canEdit: false, objects: [promptCard({ body: 'Hello' })] });
    const result = await run('canvas_save_prompt_version', { notes: 'x' });
    expect(result.error).toContain('cannot edit');
    expect(api.create).not.toHaveBeenCalled();
  });

  it('creates an unbound card in the library as version 1 and binds it', async () => {
    api.create.mockResolvedValue({ ...entry({ id: 'p-9', currentVersion: 1 }), versions: undefined });
    api.get.mockResolvedValue(entry({ id: 'p-9', currentVersion: 1, versions: [entry().versions![0]!] }));
    const { run, objects } = board({ objects: [promptCard({ body: 'Summarise {{doc}}.', variables: [] })] });
    const result = await run('canvas_save_prompt_version', { notes: 'First cut' });
    expect(result.created).toBe(true);
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ title: 'Support triage', body: 'Summarise {{doc}}.', variables: [{ name: 'doc' }], notes: 'First cut', visibility: 'private' }));
    expect(objects[0]!.data.entryId).toBe('p-9');
  });

  it('appends the next version to a bound card, keeping variable docs, and clears the cache', async () => {
    api.list.mockResolvedValue([entry()]);
    api.get.mockResolvedValue(entry());
    api.addVersion.mockResolvedValue({ ...entry({ currentVersion: 3 }), version: 3 });
    const { run, objects } = board({ objects: [promptCard({ entryId: 'p-1', body: 'Classify {{ticket}}.\nReply in JSON.', variables: ['ticket'] })] });
    await run('canvas_read_prompt');
    const result = await run('canvas_save_prompt_version', { notes: 'Structured output' });
    expect(result.versionSaved).toBe(true);
    expect(result.version).toBe(3);
    expect(result.previousVersion).toBe(2);
    expect(api.addVersion).toHaveBeenCalledWith('p-1', expect.objectContaining({ body: 'Classify {{ticket}}.\nReply in JSON.', variables: [{ name: 'ticket', description: 'The raw email' }], notes: 'Structured output' }));
    expect(objects[0]!.data.entryId).toBe('p-1');
    // The save invalidated the namespace, so the next listing reads the library again.
    await run('canvas_read_prompt');
    expect(api.list).toHaveBeenCalledTimes(2);
  });

  it('refuses a save that changes nothing', async () => {
    api.get.mockResolvedValue(entry());
    const { run } = board({ objects: [promptCard({ entryId: 'p-1', body: entry().versions![1]!.body, variables: ['ticket'] })] });
    const result = await run('canvas_save_prompt_version', { notes: 'No-op' });
    expect(result.versionSaved).toBe(false);
    expect(result.reason).toBe('unchanged');
    expect(api.addVersion).not.toHaveBeenCalled();
  });

  it('will not change what the public gallery serves without being told to', async () => {
    api.get.mockResolvedValue(entry({ visibility: 'public' }));
    api.addVersion.mockResolvedValue({ ...entry({ currentVersion: 3, visibility: 'public' }), version: 3 });
    const { run } = board({ objects: [promptCard({ entryId: 'p-1', body: 'A different prompt' })] });
    const refused = await run('canvas_save_prompt_version', { notes: 'Rewrite' });
    expect(refused.reason).toBe('public-entry');
    expect(api.addVersion).not.toHaveBeenCalled();
    const saved = await run('canvas_save_prompt_version', { notes: 'Rewrite', publishPublicly: true });
    expect(saved.publishedPublicly).toBe(true);
    expect(api.addVersion).toHaveBeenCalledTimes(1);
  });

  it('reports an id that no longer resolves instead of re-creating the prompt', async () => {
    api.get.mockRejectedValue(new Error('Prompt not found'));
    const { run } = board({ objects: [promptCard({ entryId: 'gone', body: 'Anything' })] });
    const result = await run('canvas_save_prompt_version', { notes: 'x' });
    expect(result.versionSaved).toBe(false);
    expect(result.instruction).toContain('Do NOT clear the id');
    expect(api.create).not.toHaveBeenCalled();
  });

  it('asks which card when the board holds several', async () => {
    const { run } = board({ objects: [promptCard({ body: 'a' }, 'c1'), promptCard({ body: 'b' }, 'c2')] });
    const result = await run('canvas_save_prompt_version', { notes: 'x' });
    expect(result.error).toContain('c1');
    expect(result.error).toContain('c2');
  });
});

describe('the contract', () => {
  it('classifies both tools as account-required', () => {
    const { actions } = board();
    for (const action of actions) {
      expect(ACCOUNT_REQUIRED_CANVAS_TOOLS as readonly string[]).toContain(action.name);
    }
  });
});
