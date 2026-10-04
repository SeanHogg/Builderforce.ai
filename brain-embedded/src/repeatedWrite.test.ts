import { describe, expect, it } from 'vitest';
import { WriteLedger, repeatedWriteNote } from './repeatedWrite';

const APP = { path: 'src/App.jsx', content: 'export default function App() {}' };

describe('WriteLedger', () => {
  // Chat #129: the identical 8.6 KB App.jsx written twice in a row because an error
  // from before the first write was still on screen.
  it('flags a full-content write identical to the last one that landed on its path', () => {
    const ledger = new WriteLedger();
    expect(ledger.isRepeat('canvas_write_build_file', APP)).toBe(false);
    ledger.record('canvas_write_build_file', APP, { ok: true });
    expect(ledger.isRepeat('canvas_write_build_file', APP)).toBe(true);
    // Key order is not a difference.
    expect(ledger.isRepeat('canvas_write_build_file', { content: APP.content, path: APP.path })).toBe(true);
  });

  it('lets a write with different content through', () => {
    const ledger = new WriteLedger();
    ledger.record('write_file', APP, { ok: true });
    expect(ledger.isRepeat('write_file', { ...APP, content: 'changed' })).toBe(false);
  });

  it('never covers a find/replace edit, whose repeat is not a no-op', () => {
    const ledger = new WriteLedger();
    const edit = { path: APP.path, find: 'a', replace: 'ab' };
    ledger.record('edit_file', edit, { ok: true });
    expect(ledger.isRepeat('edit_file', edit)).toBe(false);
  });

  it('forgets a path once anything else touches it', () => {
    const ledger = new WriteLedger();
    ledger.record('write_file', APP, { ok: true });
    ledger.record('edit_file', { path: APP.path, find: 'App', replace: 'Main' }, { ok: true });
    expect(ledger.isRepeat('write_file', APP)).toBe(false);
  });

  it('forgets a path whose write failed — its state is unknown', () => {
    const ledger = new WriteLedger();
    ledger.record('write_file', APP, { ok: true });
    ledger.record('write_file', { ...APP, content: 'x' }, { ok: false });
    expect(ledger.isRepeat('write_file', APP)).toBe(false);
  });

  it('forgets everything after an unscoped mutation', () => {
    const ledger = new WriteLedger();
    ledger.record('write_file', APP, { ok: true });
    ledger.record('run_command', { command: 'npx prettier --write .' }, { ok: true, unscoped: true });
    expect(ledger.isRepeat('write_file', APP)).toBe(false);
  });

  it('keeps other paths when one path is touched', () => {
    const ledger = new WriteLedger();
    const css = { path: 'src/index.css', content: 'body{}' };
    ledger.record('write_file', APP, { ok: true });
    ledger.record('write_file', css, { ok: true });
    ledger.record('delete_file', { path: APP.path }, { ok: true });
    expect(ledger.isRepeat('write_file', css)).toBe(true);
  });
});

describe('repeatedWriteNote', () => {
  it('names the tool and path and says the file already holds the content', () => {
    const note = repeatedWriteNote('canvas_write_build_file', 'src/App.jsx');
    expect(note).toContain('canvas_write_build_file');
    expect(note).toContain('src/App.jsx');
    expect(note).toContain('already holds this content');
  });
});
