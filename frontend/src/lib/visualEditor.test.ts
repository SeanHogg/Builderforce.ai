import { describe, expect, it } from 'vitest';
import {
  VISUAL_SELECT_MESSAGE,
  replaceClassNameAtLine,
  replaceTextAtLine,
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

describe('replaceClassNameAtLine', () => {
  const source = 'export default function App() {\n  return <button className="px-2">Save</button>;\n}';

  it('replaces the existing className', () => {
    const result = replaceClassNameAtLine(source, 2, 'px-6 text-lg');
    expect(result.ok && result.content).toContain('className="px-6 text-lg"');
  });

  it('adds one when the element has none', () => {
    const bare = 'return <button>Save</button>;';
    const result = replaceClassNameAtLine(bare, 1, 'px-6');
    expect(result.ok && result.content).toBe('return <button className="px-6">Save</button>;');
  });

  // Editing the wrong element is worse than not editing: two elements on one line
  // means the anchor React gave us cannot identify which one was clicked.
  it('refuses a line holding more than one element', () => {
    const two = '<a className="x">1</a><a className="y">2</a>';
    const result = replaceClassNameAtLine(two, 1, 'z');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain('more than one element');
  });

  it('refuses a line with nothing to style, and a line out of range', () => {
    expect(replaceClassNameAtLine('const x = 1;', 1, 'a').ok).toBe(false);
    expect(replaceClassNameAtLine(source, 99, 'a').ok).toBe(false);
  });

  it('handles a single-quoted class attribute without changing the quote style', () => {
    const result = replaceClassNameAtLine("<div class='old'>x</div>", 1, 'new');
    expect(result.ok && result.content).toBe("<div class='new'>x</div>");
  });
});

describe('replaceTextAtLine', () => {
  it('replaces the exact current text', () => {
    const source = '  return <button className="px-2">Save</button>;';
    const result = replaceTextAtLine(source, 1, 'Save', 'Submit');
    expect(result.ok && result.content).toBe('  return <button className="px-2">Submit</button>;');
  });

  // React reports the line the ELEMENT opens on; a multi-line element puts its
  // text a line or two later.
  it('finds text a few lines below the reported anchor', () => {
    const source = '<button\n  className="px-2"\n>\n  Save\n</button>';
    const result = replaceTextAtLine(source, 1, 'Save', 'Submit');
    expect(result.ok && result.content).toContain('  Submit');
  });

  it('refuses ambiguous text rather than editing the wrong occurrence', () => {
    const result = replaceTextAtLine('<a>Go</a><a>Go</a>', 1, 'Go', 'Stop');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain('more than once');
  });

  it('refuses text it cannot find — it is probably computed', () => {
    const result = replaceTextAtLine('<b>{label}</b>', 1, 'Save', 'Submit');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain('computed');
  });

  it('refuses empty current text', () => {
    expect(replaceTextAtLine('<b> </b>', 1, '   ', 'x').ok).toBe(false);
  });
});
