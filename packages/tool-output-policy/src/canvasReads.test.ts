import { describe, expect, it } from 'vitest';
import { isPagedReadTool, pagedReadSearchTool, shapeToolResult, truncatedResultNote, windowReadFile, windowReadFiles, toolOutputCap, windowToolResultCap, windowedCap } from './index.js';

// The Creation Canvas's reads: a board snapshot and an object are sized for a real board,
// and a build file is paged like `read_file` — naming the tool that continues it.
describe('the canvas reads', () => {
  it('have rows of their own, above the 6K default', () => {
    expect(toolOutputCap('canvas_read_snapshot')).toBeGreaterThan(6_000);
    expect(toolOutputCap('canvas_read_object')).toBeGreaterThan(6_000);
    expect(toolOutputCap('canvas_read_build_file')).toBe(toolOutputCap('read_file'));
  });

  it('are sized by the window the way every other tool is: the smaller of the row and the window share', () => {
    const window = 8_000;
    expect(windowedCap('canvas_read_snapshot', toolOutputCap('canvas_read_snapshot'), window)).toBe(windowToolResultCap(window));
    expect(windowedCap('canvas_read_snapshot', toolOutputCap('canvas_read_snapshot'))).toBe(toolOutputCap('canvas_read_snapshot'));
  });

  it('treat a build file as a paged read', () => {
    expect(isPagedReadTool('canvas_read_build_file')).toBe(true);
    expect(isPagedReadTool('canvas_read_snapshot')).toBe(false);
    const content = 'const a = 1;\n'.repeat(3_000);
    const shaped = shapeToolResult('canvas_read_build_file', { ok: true, path: 'a.js', content, offset: 1, totalLines: 3_001 }, { maxChars: 16_000 });
    const served = JSON.parse(shaped.content) as { truncated: boolean; note: string };
    expect(shaped.truncated).toBe(true);
    expect(served.truncated).toBe(true);
    expect(served.note).toContain('call canvas_read_build_file again with offset');
  });

  it('point a line too long to page at the canvas search tool, not search_code', () => {
    const minified = { ok: true, path: 'a.js', content: 'x'.repeat(40_000), offset: 1, totalLines: 1 };
    const windowed = windowReadFile(minified, { tool: 'canvas_read_build_file', maxChars: 4_000 });
    expect(pagedReadSearchTool('canvas_read_build_file')).toBe('canvas_search_build_files');
    expect(String(windowed.value.note)).toContain('canvas_search_build_files');
    expect(String(windowed.value.note)).not.toContain('search_code');
  });

  it('say where the lines AFTER a line too long to page continue', () => {
    const file = { ok: true, path: 'a.js', content: `${'x'.repeat(40_000)}\nconst b = 2;`, offset: 1, totalLines: 2 };
    const note = String(windowReadFile(file, { tool: 'canvas_read_build_file', maxChars: 4_000 }).value.note);
    expect(note).toContain('offset 2');
    expect(note).toContain('canvas_read_build_file');
  });

  it('give a file whose share is too small for any of its first line NO content, and say how to read it', () => {
    const file = { ok: true, path: 'a.js', content: 'x'.repeat(5_000), offset: 1, totalLines: 1 };
    const windowed = windowReadFile(file, { tool: 'canvas_read_build_file', maxChars: 500, alone: 'a.js' });
    expect(windowed.value.content).toBe('');
    expect(windowed.truncated).toBe(true);
    expect(String(windowed.value.note)).toContain('Skipped');
    expect(String(windowed.value.note)).toContain('ONLY the path "a.js"');
  });

  it('promise an offset continuation only for a file read ALONE', () => {
    const file = (path: string) => ({ ok: true, path, content: 'const a = 1;\n'.repeat(3_000), offset: 1, totalLines: 3_001 });
    const many = windowReadFiles({ ok: true, files: [file('a.js'), file('b.js')] }, { tool: 'canvas_read_build_file', maxChars: 16_000 });
    const notes = (many.value.files as Array<{ note?: string }>).map((f) => String(f.note));
    expect(notes[0]).toContain('ONLY the path "a.js"');
    expect(notes[1]).toContain('ONLY the path "b.js"');
  });

  it('leave read_file’s multi-path note as it was: its offset applies to each path', () => {
    const file = (path: string) => ({ ok: true, path, content: 'const a = 1;\n'.repeat(3_000), offset: 1, totalLines: 3_001 });
    const many = windowReadFiles({ ok: true, files: [file('a.js'), file('b.js')] }, { maxChars: 16_000 });
    const notes = (many.value.files as Array<{ note?: string }>).map((f) => String(f.note));
    for (const note of notes) {
      expect(note).toContain('call read_file again with offset');
      expect(note).not.toContain('ONLY');
    }
  });
});
