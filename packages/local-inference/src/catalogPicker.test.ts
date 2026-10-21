import { describe, expect, it } from 'vitest';
import {
  LOCAL_MODEL_CATALOG,
  LOCAL_PICKER_GROUPS,
  localPickerGroup,
  localPickerView,
  type LocalCatalogModel,
} from './index.js';

/**
 * The picker layout every host renders: curated rows by use first, the rest behind "All
 * models", unfit rows hidden but reported, never an embedder or a vision-only build.
 */

const row = (ref: string, fields: Partial<LocalCatalogModel> = {}) => ({
  ref,
  uses: ['chat'] as LocalCatalogModel['uses'],
  recommended: false,
  tools: false,
  ...fields,
});

describe('localPickerGroup', () => {
  it('puts tool-capable rows under tools, then the most specific use', () => {
    expect(localPickerGroup(row('a', { tools: true, uses: ['coding'] }))).toBe('tools');
    expect(localPickerGroup(row('b', { uses: ['coding'] }))).toBe('coding');
    expect(localPickerGroup(row('c', { uses: ['reasoning', 'math'] }))).toBe('reasoning');
    expect(localPickerGroup(row('d', { uses: ['math'] }))).toBe('math');
    expect(localPickerGroup(row('e'))).toBe('chat');
  });
});

describe('localPickerView', () => {
  it('groups the curated rows in section order and keeps the rest behind All models', () => {
    const view = localPickerView([
      row('chat-pick', { recommended: true }),
      row('extra'),
      row('coder', { recommended: true, uses: ['coding'] }),
      row('agent', { recommended: true, tools: true }),
    ]);
    expect(view.groups.map((g) => [g.group, g.rows.map((r) => r.ref)])).toEqual([
      ['tools', ['agent']],
      ['chat', ['chat-pick']],
      ['coding', ['coder']],
    ]);
    expect(view.more.map((r) => r.ref)).toEqual(['extra']);
    expect(view.hidden).toEqual([]);
  });

  it('drops embedding and vision-only rows entirely', () => {
    const view = localPickerView([
      row('embed', { recommended: true, uses: ['embedding'] }),
      row('eyes', { uses: ['vision'] }),
    ]);
    expect(view).toEqual({ groups: [], more: [], hidden: [] });
  });

  it('hides rows the device cannot run and hands them back for the notice', () => {
    const view = localPickerView([row('big', { recommended: true }), row('small', { recommended: true })], {
      fits: (r) => r.ref === 'small',
    });
    expect(view.groups.flatMap((g) => g.rows.map((r) => r.ref))).toEqual(['small']);
    expect(view.hidden.map((r) => r.ref)).toEqual(['big']);
  });

  it('always lists a row the person holds, even when this device cannot run it', () => {
    const view = localPickerView([row('mine', { recommended: false }), row('other', { recommended: true })], {
      fits: () => false,
      pinned: (r) => r.ref === 'mine',
    });
    expect(view.groups.flatMap((g) => g.rows.map((r) => r.ref))).toEqual(['mine']);
    expect(view.hidden.map((r) => r.ref)).toEqual(['other']);
  });

  it('lifts a row the person already has out of All models', () => {
    const view = localPickerView([row('mine'), row('other')], { pinned: (r) => r.ref === 'mine' });
    expect(view.groups).toEqual([{ group: 'chat', rows: [expect.objectContaining({ ref: 'mine' })] }]);
    expect(view.more.map((r) => r.ref)).toEqual(['other']);
  });

  it('lays the shipped catalog out with every section curated and most rows behind All models', () => {
    const view = localPickerView(LOCAL_MODEL_CATALOG);
    expect(view.groups.map((g) => g.group)).toEqual([...LOCAL_PICKER_GROUPS]);
    const featured = view.groups.reduce((n, g) => n + g.rows.length, 0);
    expect(featured).toBeLessThan(view.more.length);
  });
});
