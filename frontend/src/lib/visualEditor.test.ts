import { describe, expect, it } from 'vitest';
import {
  VISUAL_SELECT_MESSAGE,
  VISUAL_UNRESOLVED_MESSAGE,
  isVisualUnresolved,
  visualSelectionFrom,
  withVisualEditor,
  workspaceRelativePath,
} from './visualEditor';

describe('withVisualEditor', () => {
  it('injects the overlay into the mounted entry document only', () => {
    const files = { 'index.html': '<html><head><title>x</title></head></html>', 'src/App.jsx': 'x' };
    const out = withVisualEditor(files);
    expect(out['index.html']).toContain('builderforce:visual-select');
    expect(out['src/App.jsx']).toBe('x');
  });

  it('leaves files alone when there is no head', () => {
    const files = { 'index.html': 'not html' };
    expect(withVisualEditor(files)).toBe(files);
  });
});

describe('workspaceRelativePath', () => {
  it('reduces an absolute dev-server path to the workspace-relative one', () => {
    expect(workspaceRelativePath('/home/projects/app/src/App.jsx')).toBe('src/App.jsx');
    expect(workspaceRelativePath('src/App.jsx')).toBe('src/App.jsx');
    expect(workspaceRelativePath('C:\\work\\app\\src\\App.jsx')).toBe('src/App.jsx');
  });
});

describe('visualSelectionFrom', () => {
  it('parses a selection and normalises the path', () => {
    const parsed = visualSelectionFrom({
      type: VISUAL_SELECT_MESSAGE,
      payload: { file: '/app/src/App.jsx', line: 12, column: 4, tag: 'button', className: 'btn', text: 'Save' },
    });
    expect(parsed).toEqual({ file: 'src/App.jsx', line: 12, column: 4, tag: 'button', className: 'btn', text: 'Save' });
  });

  it('rejects anything that is not ours or has no usable anchor', () => {
    expect(visualSelectionFrom(null)).toBeNull();
    expect(visualSelectionFrom({ type: 'other' })).toBeNull();
    expect(visualSelectionFrom({ type: VISUAL_SELECT_MESSAGE, payload: { file: 'a.jsx' } })).toBeNull();
    expect(visualSelectionFrom({ type: VISUAL_SELECT_MESSAGE, payload: { file: '', line: 3 } })).toBeNull();
  });
});

describe('isVisualUnresolved', () => {
  it('recognises the overlay saying a click had no source anchor', () => {
    expect(isVisualUnresolved({ type: VISUAL_UNRESOLVED_MESSAGE })).toBe(true);
    expect(isVisualUnresolved({ type: VISUAL_SELECT_MESSAGE })).toBe(false);
    expect(isVisualUnresolved(null)).toBe(false);
  });

  it('is posted by the overlay instead of the click doing nothing', () => {
    const out = withVisualEditor({ 'index.html': '<html><head></head></html>' });
    expect(out['index.html']).toContain(VISUAL_UNRESOLVED_MESSAGE);
  });
});
