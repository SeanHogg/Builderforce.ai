import { describe, expect, it } from 'vitest';
import { canvasDiagram, canvasDocument, canvasFiles, canvasObjectMarkdown, canvasSlides, formatBytes, paginateDocument, plainText } from './canvasDocuments';
import { PAGE_BREAK_MARKER } from './officeFormats';
import type { CreationNodeData } from '@/components/creation-canvas/types';

const object = (data: Partial<CreationNodeData> & { kind: CreationNodeData['kind'] }): CreationNodeData => ({ title: 'Untitled', ...data } as CreationNodeData);

describe('canvasDocument', () => {
  it('reads the authored body, its outline, and its scale', () => {
    const markdown = `# Market analysis\n\n## Competitors\n\n${'word '.repeat(500)}`;
    const document = canvasDocument(object({ kind: 'document', title: 'Market analysis', markdown }));
    expect(document?.headings.map((heading) => heading.text)).toEqual(['Market analysis', 'Competitors']);
    expect(document?.wordCount).toBeGreaterThan(500);
    expect(document?.pageCount).toBeGreaterThan(1);
    expect(document?.readingMinutes).toBeGreaterThanOrEqual(2);
  });

  it('is null for an object with no authored body, so a card can say so', () => {
    expect(canvasDocument(object({ kind: 'document', status: 'Draft' }))).toBeNull();
  });

  it('renders a chat object as its transcript', () => {
    const data = object({ kind: 'chat', title: 'Brain', messages: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }] });
    expect(canvasDocument(data)?.markdown).toContain('## Brain');
    expect(canvasObjectMarkdown(data)).toContain('## You');
  });

  it('falls back to a title stub only for export, never for the preview', () => {
    expect(canvasObjectMarkdown(object({ kind: 'note', title: 'Empty', status: 'Draft' }))).toContain('# Empty');
  });

  it('honours the pages an imported file declared', () => {
    const markdown = `# Cover\n\n${PAGE_BREAK_MARKER}\n\n## Detail\n\nBody`;
    const document = canvasDocument(object({ kind: 'document', title: 'Imported', markdown }));
    expect(document?.pages).toEqual(['# Cover', '## Detail\n\nBody']);
    expect(document?.pageCount).toBe(2);
  });

  it('keeps the break marker out of the outline, the word count, and the export', () => {
    const data = object({ kind: 'document', title: 'Imported', markdown: `Page one\n\n${PAGE_BREAK_MARKER}\n\nPage two` });
    const document = canvasDocument(data);
    expect(document?.markdown).not.toContain(PAGE_BREAK_MARKER);
    expect(document?.wordCount).toBe(4);
    expect(canvasObjectMarkdown(data)).toBe('Page one\n\nPage two');
  });
});

describe('paginateDocument', () => {
  it('flows authored markdown at a page budget, never splitting a block', () => {
    const table = '| a | b |\n| --- | --- |\n| 1 | 2 |';
    const pages = paginateDocument(`${'word '.repeat(460)}\n\n${table}`);
    expect(pages).toHaveLength(2);
    expect(pages[1]).toBe(table);
  });

  it('is empty for an empty body, so a card can say nothing was written', () => {
    expect(paginateDocument('   ')).toEqual([]);
  });
});

describe('canvasSlides', () => {
  it('prefers authored slide items', () => {
    const slides = canvasSlides(object({ kind: 'slides', items: [{ title: 'Why now', bullets: ['Budget cycle', 'Competitor gap'] }] }));
    expect(slides).toEqual([{ title: 'Why now', bullets: ['Budget cycle', 'Competitor gap'] }]);
  });

  it('splits a markdown deck on rules', () => {
    const slides = canvasSlides(object({ kind: 'slides', markdown: '# Title\n\n---\n\n## Agenda\n\n- One\n- Two' }));
    expect(slides.map((slide) => slide.title)).toEqual(['Title', 'Agenda']);
    expect(slides[1]?.bullets).toEqual(['One', 'Two']);
  });

  it('splits on headings when there are no rules', () => {
    const slides = canvasSlides(object({ kind: 'slides', markdown: '## First\n\n- A\n\n## Second\n\n- B' }));
    expect(slides.map((slide) => slide.title)).toEqual(['First', 'Second']);
  });

  it('strips markdown emphasis from slide text', () => {
    expect(plainText('**Bold** and [linked](https://example.com)')).toBe('Bold and linked');
  });
});

describe('canvasDiagram', () => {
  it('detects draw.io XML', () => {
    expect(canvasDiagram(object({ kind: 'diagram', diagram: '<mxfile><diagram>x</diagram></mxfile>' }))?.format).toBe('drawio');
  });

  it('detects a fenced mermaid block inside a document body', () => {
    const diagram = canvasDiagram(object({ kind: 'diagram', content: 'Intro\n\n```mermaid\nflowchart TD\nA-->B\n```' }));
    expect(diagram).toEqual({ format: 'mermaid', source: 'flowchart TD\nA-->B' });
  });

  it('honours the declared notation when the source carries no marker', () => {
    expect(canvasDiagram(object({ kind: 'diagram', diagramFormat: 'mermaid', diagram: 'A --> B' }))?.format).toBe('mermaid');
  });

  it('is null when nothing diagram-like was authored', () => {
    expect(canvasDiagram(object({ kind: 'diagram', content: 'just a sentence' }))).toBeNull();
  });
});

describe('canvasFiles', () => {
  it('lists the document, deck, diagram, and sheet an object IS', () => {
    const files = canvasFiles([
      { id: 'n1', data: object({ kind: 'document', title: 'Market analysis', markdown: '# Market analysis\n\nBody' }) },
      { id: 'n2', data: object({ kind: 'slides', title: 'Board deck', markdown: '## One\n\n## Two' }) },
      { id: 'n3', data: object({ kind: 'diagram', title: 'System map', diagram: '<mxGraphModel></mxGraphModel>' }) },
      { id: 'n4', data: object({ kind: 'spreadsheet', title: 'Pricing', columns: ['Plan', 'Price'], rows: [{ Plan: 'Pro', Price: '99' }] }) },
    ]);
    expect(files.map((file) => file.name)).toEqual(expect.arrayContaining(['market-analysis.md', 'board-deck.md', 'system-map.drawio', 'pricing.csv']));
    expect(files.every((file) => file.sizeBytes && file.sizeBytes > 0)).toBe(true);
    expect(files.find((file) => file.name === 'pricing.csv')?.category).toBe('spreadsheet');
  });

  it('lists delivered exports alongside the object they came from', () => {
    const files = canvasFiles([{
      id: 'n1',
      data: object({
        kind: 'slides', title: 'Board deck', markdown: '## One',
        deliverables: [
          { id: 'd1', action: 'export', artifactKind: 'pptx', status: 'delivered', createdAt: '2026-08-01T10:00:00.000Z', completedAt: '2026-08-01T10:00:01.000Z', fileName: 'board-deck.pptx', provider: 'builderforce-office-export' },
          { id: 'd2', action: 'export', artifactKind: 'docx', status: 'failed', createdAt: '2026-08-01T10:00:00.000Z', fileName: 'never.docx' },
        ],
      }),
    }]);
    expect(files.map((file) => file.name)).toEqual(['board-deck.pptx', 'board-deck.md']);
    expect(files[0]).toMatchObject({ category: 'presentation', source: 'export', editable: false });
    expect(files.some((file) => file.name === 'never.docx')).toBe(false);
  });

  it('skips objects that have produced nothing', () => {
    expect(canvasFiles([{ id: 'n1', data: object({ kind: 'document', status: 'Draft' }) }])).toEqual([]);
  });

  it('rounds sizes the same way for every surface', () => {
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
  });
});
