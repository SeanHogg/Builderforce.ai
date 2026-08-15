import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CreationNode } from './CreationNode';
import { CanvasFilesPanel } from './CanvasFilesPanel';
import { canvasFiles } from '@/lib/canvasDocuments';
import type { CreationNodeData } from './types';

const youtube = vi.hoisted(() => ({
  connections: vi.fn(), connectUrl: vi.fn(), publish: vi.fn(), disconnect: vi.fn(),
}));
vi.mock('@/lib/youtubeApi', () => ({ youtubeApi: youtube }));

/**
 * The regression these cover: a researched document, a generated deck, and a
 * Draw.io diagram all rendered as one line of grey placeholder text, and there
 * was nowhere to see the files a session had actually produced.
 */

/** The real catalogs, resolved the way next-intl resolves them — including the
 * `plural` forms the file-count and slide-count labels are written in, so these
 * assert the string a person actually reads. */
vi.mock('next-intl', async () => (await import('@/test/realCatalogTranslations')).realCatalogIntlMock(
  (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
));

vi.mock('@xyflow/react', async () => {
  const inert = () => null;
  return {
    Handle: inert, NodeResizer: inert, Position: { Left: 'left', Right: 'right' },
    // An empty board: these cards are rendered on their own, so no object here has
    // been given an authored size.
    useStore: (selector: (state: { nodeLookup: Map<string, unknown> }) => unknown) => selector({ nodeLookup: new Map() }),
  };
});

const nodeProps = {
  id: 'object-1', type: 'creation' as const, selected: false, dragging: false, zIndex: 0,
  selectable: true, deletable: true, draggable: true, isConnectable: true,
  positionAbsoluteX: 0, positionAbsoluteY: 0,
};

const renderNode = (data: CreationNodeData, overrides: Partial<React.ComponentProps<typeof CreationNode>> = {}) =>
  render(<CreationNode {...nodeProps} data={data} {...overrides} />);

/**
 * The formats a card offers, by ACCESSIBLE NAME.
 *
 * Each button carries a decorative leading glyph so the row has distinct
 * silhouettes rather than reading as a paragraph of identical text buttons. The
 * glyph is `aria-hidden`, so it is not part of the button's name — and this
 * reads the name rather than raw `textContent` so the assertions stay about what
 * a person (or a screen reader) is actually offered.
 */
function exportFormats(data: CreationNodeData): string[] {
  const { unmount } = renderNode(data, { onExport: vi.fn() });
  const group = screen.queryByRole('group', { name: 'Download' });
  const labels = group
    ? within(group).getAllByRole('button').map((button) => [...button.childNodes]
        .filter((node) => !(node instanceof HTMLElement && node.getAttribute('aria-hidden') === 'true'))
        .map((node) => node.textContent ?? '')
        .join('')
        .trim())
    : [];
  unmount();
  return labels;
}

describe('document objects render the document', () => {
  it('renders headings, lists, and tables instead of one flat paragraph', () => {
    renderNode({
      kind: 'document', title: 'Market analysis',
      markdown: '# Market analysis\n\n## Competitors\n\n- Acme holds 42%\n- Globex is growing\n\n| Vendor | Share |\n| --- | --- |\n| Acme | 42% |',
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Market analysis' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Competitors' })).toBeTruthy();
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Acme holds 42%', 'Globex is growing']);
    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('says so plainly when nothing has been written yet', () => {
    renderNode({ kind: 'document', title: 'Untitled document', status: 'Draft' });
    expect(screen.getByText(/no document written yet/i)).toBeTruthy();
  });
});

describe('slides objects render slides', () => {
  it('turns a markdown deck into numbered slide thumbnails', () => {
    renderNode({ kind: 'slides', title: 'Board deck', markdown: '# Why now\n\n- Budget cycle\n\n## The ask\n\n- Two engineers' });
    expect(screen.getByText('Why now')).toBeTruthy();
    expect(screen.getByText('The ask')).toBeTruthy();
    expect(screen.getByText('Budget cycle')).toBeTruthy();
    expect(screen.getByText('2 slides')).toBeTruthy();
  });
});

describe('diagram objects render the drawing', () => {
  it('draws a Draw.io scene as real shapes and connectors', async () => {
    renderNode({
      kind: 'diagram', title: 'System map',
      diagram: `<mxGraphModel><root><mxCell id="0"/>
        <mxCell id="a" value="Research" style="rounded=1" vertex="1" parent="0"><mxGeometry x="0" y="0" width="120" height="60" as="geometry"/></mxCell>
        <mxCell id="b" value="Report" style="ellipse" vertex="1" parent="0"><mxGeometry x="220" y="0" width="120" height="60" as="geometry"/></mxCell>
        <mxCell id="e" edge="1" parent="0" source="a" target="b"><mxGeometry relative="1" as="geometry"/></mxCell>
      </root></mxGraphModel>`,
    });
    const drawing = await screen.findByRole('img', { name: 'System map' });
    expect(within(drawing).getByText('Research')).toBeTruthy();
    expect(within(drawing).getByText('Report')).toBeTruthy();
    expect(drawing.querySelector('polyline')).toBeTruthy();
    expect(drawing.querySelector('ellipse')).toBeTruthy();
  });

  it('previews an image embedded by the draw.io conversion', async () => {
    renderNode({
      kind: 'diagram', title: 'Imported sketch',
      diagram: '<mxGraphModel><root><mxCell id="0"/><mxCell id="pic" style="shape=image;image=data:image/png;base64,AAAA;" vertex="1" parent="0"><mxGeometry x="0" y="0" width="320" height="180" as="geometry"/></mxCell></root></mxGraphModel>',
    });
    const drawing = await screen.findByRole('img', { name: 'Imported sketch' });
    expect(drawing.querySelector('image')?.getAttribute('href')).toBe('data:image/png;base64,AAAA');
  });
});

describe('spreadsheet objects are editable on the card', () => {
  const sheet: CreationNodeData = {
    kind: 'spreadsheet', title: 'Pricing',
    columns: ['Plan', 'Price'], rows: [{ Plan: 'Pro', Price: '99' }],
  };

  it('writes an edited cell back through the object writer', () => {
    const onEditData = vi.fn();
    renderNode(sheet, { onEditData });
    fireEvent.click(screen.getByRole('button', { name: '99' }));
    const editor = screen.getByRole('textbox', { name: /edit Price, row 1/i });
    fireEvent.change(editor, { target: { value: '129' } });
    fireEvent.blur(editor);
    expect(onEditData).toHaveBeenCalledWith('object-1', expect.objectContaining({ rows: [{ Plan: 'Pro', Price: '129' }], rowCount: 1 }));
  });

  it('adds rows and columns', () => {
    const onEditData = vi.fn();
    renderNode(sheet, { onEditData });
    fireEvent.click(screen.getByRole('button', { name: '+ Row' }));
    expect(onEditData).toHaveBeenCalledWith('object-1', expect.objectContaining({ rowCount: 2 }));
    fireEvent.click(screen.getByRole('button', { name: '+ Column' }));
    expect(onEditData).toHaveBeenLastCalledWith('object-1', expect.objectContaining({ columns: ['Plan', 'Price', 'Column 3'] }));
  });

  it('stays read-only when the canvas passes no writer', () => {
    renderNode(sheet);
    expect(screen.queryByRole('button', { name: '+ Row' })).toBeNull();
    expect(screen.getByText('99')).toBeTruthy();
  });
});

describe('video objects are authored on the Canvas', () => {
  const video: CreationNodeData = {
    kind: 'video', title: 'Launch video', status: 'Editable',
    videoSources: [{ id: 'shot-1', kind: 'image', captureKind: 'ai', url: 'data:image/png;base64,AAAA', fileName: 'opening.png', mimeType: 'image/png', durationSeconds: 4 }],
    videoTimeline: { version: 1, fps: 30, width: 1920, height: 1080, backgroundColor: '#000000', clips: [{ id: 'clip-1', sourceId: 'shot-1', track: 'visual', startSeconds: 0, durationSeconds: 4, trimStartSeconds: 0, volume: 1, label: 'Opening' }] },
  };

  it('renders capture, music, playback, export, and timeline editing together', () => {
    const onEditData = vi.fn();
    renderNode(video, { onEditData });
    expect(screen.getByRole('button', { name: 'Record screen' })).toBeTruthy();
    expect(screen.getByText('Add music')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export WebM' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Video timeline' })).toBeTruthy();
    const start = screen.getByRole('spinbutton', { name: 'Start' });
    fireEvent.change(start, { target: { value: '1.5' } });
    expect(onEditData).toHaveBeenCalledWith('object-1', expect.objectContaining({ videoTimeline: expect.objectContaining({ clips: [expect.objectContaining({ startSeconds: 1.5 })] }) }));
  });

  it('loads authenticated YouTube publishing after a durable render exists', async () => {
    youtube.connections.mockResolvedValue({ configured: true, connections: [{ id: 7, accountEmail: 'creator@example.com', displayName: 'Demo channel', status: 'connected', lastError: null }] });
    renderNode({ ...video, renderedVideoStorageKey: '1/user/demo.webm', renderedVideoMimeType: 'video/webm' });
    expect(await screen.findByRole('region', { name: 'Publish to YouTube' })).toBeTruthy();
    expect(await screen.findByRole('option', { name: 'Demo channel' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Publish to YouTube' })).toBeTruthy();
  });
});

describe('files library', () => {
  const files = canvasFiles([
    { id: 'n1', data: { kind: 'document', title: 'Market analysis', markdown: '# Market analysis\n\nBody' } as CreationNodeData },
    { id: 'n2', data: { kind: 'spreadsheet', title: 'Pricing', columns: ['Plan'], rows: [{ Plan: 'Pro' }] } as CreationNodeData },
  ]);

  it('lists every file the session holds and opens the object behind one', () => {
    const onOpen = vi.fn();
    render(<CanvasFilesPanel files={files} onOpen={onOpen} onDownload={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('market-analysis.md')).toBeTruthy();
    expect(screen.getByText('pricing.csv')).toBeTruthy();
    fireEvent.click(screen.getByText('market-analysis.md'));
    expect(onOpen).toHaveBeenCalledWith('n1');
  });

  it('filters by type and by name', () => {
    render(<CanvasFilesPanel files={files} onOpen={vi.fn()} onDownload={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Spreadsheet' }));
    expect(screen.queryByText('market-analysis.md')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search files' }), { target: { value: 'market' } });
    expect(screen.queryByText('pricing.csv')).toBeNull();
  });

  it('downloads the file a row stands for', () => {
    const onDownload = vi.fn();
    render(<CanvasFilesPanel files={files} onOpen={vi.fn()} onDownload={onDownload} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download pricing.csv' }));
    expect(onDownload).toHaveBeenCalledWith(expect.objectContaining({ name: 'pricing.csv' }));
  });

  it('tells a new session what will land here', () => {
    render(<CanvasFilesPanel files={[]} onOpen={vi.fn()} onDownload={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/no files yet/i)).toBeTruthy();
  });
});

/**
 * The regression these cover: a document could be read on the board but only
 * edited through a markdown textarea in a side panel, and the file it produces
 * lived on a third surface again.
 */
describe('a document is written and taken away from its own card', () => {
  const document: CreationNodeData = {
    kind: 'document', title: 'Market analysis',
    markdown: '# Market analysis\n\nDemand is **strong** in EMEA.',
  };

  it('offers no editing control on a board this person cannot edit', () => {
    renderNode(document, { onExport: vi.fn() });
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Word' })).toBeTruthy();
  });

  it('takes the document away as Word or as PDF', () => {
    const onExport = vi.fn();
    renderNode(document, { onExport });
    fireEvent.click(screen.getByRole('button', { name: 'Word' }));
    expect(onExport).toHaveBeenCalledWith('object-1', 'docx');
    fireEvent.click(screen.getByRole('button', { name: 'PDF' }));
    expect(onExport).toHaveBeenCalledWith('object-1', 'pdf');
  });

  it('opens the written document in the editor, formatted', () => {
    renderNode(document, { onEditData: vi.fn() });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const surface = screen.getByRole('textbox', { name: 'Market analysis' });
    expect(surface.querySelector('h1')?.textContent).toBe('Market analysis');
    expect(surface.querySelector('strong')?.textContent).toBe('strong');
    expect(screen.getByRole('toolbar', { name: 'Formatting' })).toBeTruthy();
  });

  it('writes an edit back as markdown, into both body fields', () => {
    const onEditData = vi.fn();
    renderNode(document, { onEditData });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const surface = screen.getByRole('textbox', { name: 'Market analysis' });
    surface.innerHTML = '<h1>Market analysis</h1><p>Demand is <strong>weak</strong> in EMEA.</p>';
    fireEvent.blur(surface);
    expect(onEditData).toHaveBeenCalledWith('object-1', {
      markdown: '# Market analysis\n\nDemand is **weak** in EMEA.',
      content: '# Market analysis\n\nDemand is **weak** in EMEA.',
    });
  });

  it('keeps the page breaks an imported file declared', () => {
    const onEditData = vi.fn();
    renderNode({ ...document, markdown: 'Page one.\n\n<!--page-break-->\n\nPage two.' }, { onEditData });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const surface = screen.getByRole('textbox', { name: 'Market analysis' });
    surface.innerHTML = surface.innerHTML.replace('Page one.', 'Page one, revised.');
    fireEvent.blur(surface);
    expect(onEditData).toHaveBeenCalledWith('object-1', expect.objectContaining({
      markdown: 'Page one, revised.\n\n<!--page-break-->\n\nPage two.',
    }));
  });

  it('does not rewrite a document nobody touched', () => {
    const onEditData = vi.fn();
    renderNode(document, { onEditData });
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.blur(screen.getByRole('textbox', { name: 'Market analysis' }));
    expect(onEditData).not.toHaveBeenCalled();
  });
});

/**
 * The regression these cover: only the document card had downloads, and the one
 * format every other artifact could reach was markdown — a deck, a sheet and a
 * diagram had no way off the board in the format their own tool opens.
 */
describe('every artifact leaves the board in its own native format', () => {

  it('offers a deck as PowerPoint before anything else', () => {
    expect(exportFormats({ kind: 'slides', title: 'Q3 review', markdown: '## Growth\n\n- EMEA up 12%\n\n## Risks\n\n- Churn' }))
      .toEqual(['PowerPoint', 'PDF', 'Markdown', 'Copy']);
  });

  it('offers a sheet as Excel before CSV', () => {
    expect(exportFormats({ kind: 'spreadsheet', title: 'Pricing', columns: ['Plan', 'Price'], rows: [{ Plan: 'Pro', Price: 40 }] }))
      .toEqual(['Excel', 'CSV']);
  });

  it('offers a diagram in its own notation, plus SVG', () => {
    expect(exportFormats({ kind: 'diagram', title: 'Flow', diagram: 'graph TD;A-->B;' }))
      .toEqual(['Mermaid', 'SVG', 'PDF', 'Copy']);
  });

  it('names the notation the diagram is actually written in', () => {
    expect(exportFormats({ kind: 'diagram', title: 'Flow', diagram: '<mxfile><diagram/></mxfile>' })[0]).toBe('Draw.io');
  });

  it('offers a document as Word before PDF or Markdown', () => {
    expect(exportFormats({ kind: 'document', title: 'Analysis', markdown: '# Analysis' }))
      .toEqual(['Word', 'PDF', 'Markdown', 'Copy']);
  });

  it('offers nothing for an object that is not a file', () => {
    expect(exportFormats({ kind: 'agent', title: 'Researcher' })).toEqual([]);
  });

  it('keeps transcript actions in the chat, not on the Brain canvas object', () => {
    expect(exportFormats({ kind: 'chat', title: 'Brain', content: '# Answer' })).toEqual([]);
  });

  it('drops a format the object cannot currently fill', () => {
    // A sheet with no rows yet has no columns to write, so Excel and CSV are
    // absent rather than present-and-failing.
    expect(exportFormats({ kind: 'spreadsheet', title: 'Empty' })).toEqual([]);
    // A deck whose outline has not been written yet cannot render slides.
    expect(exportFormats({ kind: 'slides', title: 'Untitled deck' })).toEqual(['Markdown', 'Copy']);
  });

  it('asks the board to export the format that was clicked', () => {
    const onExport = vi.fn();
    renderNode({ kind: 'spreadsheet', title: 'Pricing', columns: ['Plan'], rows: [{ Plan: 'Pro' }] }, { onExport });
    fireEvent.click(screen.getByRole('button', { name: 'Excel' }));
    expect(onExport).toHaveBeenCalledWith('object-1', 'xlsx');
  });
});

/**
 * The regression these cover: the capability contract advertised formats the
 * board could not produce — a PDF for a drawn artifact, HTML for a resume — so a
 * person was promised a file that did not exist.
 */
describe('drawn and written artifacts fill the formats the contract promises', () => {
  const drawing = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40"/></svg>');


  it('offers a resume as Word, PDF and HTML — every form a recruiter asks for', () => {
    expect(exportFormats({ kind: 'resume', title: 'CV', markdown: '# Jane\n\n## Experience' }))
      .toEqual(['Word', 'PDF', 'HTML', 'Markdown', 'Copy']);
  });

  it('offers a drawn CAD profile as SVG and PDF', () => {
    expect(exportFormats({ kind: 'cad', title: 'Bracket', thumbnailUrl: drawing })).toEqual(['SVG', 'PDF']);
  });

  it('offers a rendered comic as PDF', () => {
    expect(exportFormats({ kind: 'comic', title: 'Strip', thumbnailUrl: 'https://example.com/strip.png' })).toEqual(['PDF']);
  });

  it('offers nothing for a drawn kind that has not been generated yet', () => {
    // Promising a PDF of a picture that does not exist is the defect these close.
    expect(exportFormats({ kind: 'cad', title: 'Bracket' })).toEqual([]);
    expect(exportFormats({ kind: 'comic', title: 'Strip' })).toEqual([]);
  });
});

/**
 * The regression this covers: reading a dropped file is synchronous CPU that can
 * hold the main thread for seconds, and the node was only created AFTER the
 * parse — so the drop overlay vanished on release and the canvas showed nothing
 * at all until the last file finished. The card is the receipt for the drop.
 */
describe('a dropped file gets a card before it has been read', () => {
  const pending: CreationNodeData = {
    kind: 'file', title: 'Market analysis.pdf', fileName: 'Market analysis.pdf',
    fileSize: 2_400_000, importPending: true,
  };

  it('says it is reading, and names the file it is standing in for', () => {
    renderNode(pending);
    const status = screen.getByRole('status');
    expect(within(status).getByText('Reading the file…')).toBeTruthy();
    expect(status.textContent).toContain('Market analysis.pdf');
    expect(status.textContent).toContain('2.3 MB');
  });

  it('offers no downloads while there is nothing yet to take away', () => {
    renderNode(pending, { onExport: vi.fn() });
    expect(screen.queryByRole('group', { name: 'Download' })).toBeNull();
  });

  it('becomes the real artifact in place once the read finishes', () => {
    // The stub keeps its node id and position; only `data` is replaced, which is
    // why the card a person is looking at fills in rather than being swapped for
    // a second one somewhere else on the board.
    renderNode({ kind: 'document', title: 'Market analysis', markdown: '# Market analysis\n\nDemand is strong.' });
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Market analysis' })).toBeTruthy();
  });
});

/**
 * The sticky note — the one card that is only its text.
 *
 * Worth its own coverage because it is the object a Miro import is mostly made of
 * (`lib/miroImport.ts` maps `sticky_note`, `text` and `shape` onto it), and because
 * it is the only kind that deliberately breaks the card's shape: no title bar, no
 * status pill, and a title that is content rather than a name.
 */
describe('sticky note', () => {
  const sticky: CreationNodeData = { kind: 'sticky', title: 'Onboarding is confusing', stickyColor: '#fde68a' };

  it('shows its text and nothing else — no title bar, no status pill', () => {
    renderNode(sticky, { onEditData: vi.fn() });
    // The text is the whole card, and it is EDITABLE when the board can be edited:
    // a sticky you cannot type on is a picture of a sticky.
    expect((screen.getByLabelText('Sticky note text') as HTMLTextAreaElement).value).toBe('Onboarding is confusing');
    // The header is hidden in CSS rather than branched around, so the card keeps one
    // structure — but the title must not ALSO be drawn as a heading, or a screen
    // reader hears the note's text twice.
    expect(screen.queryByRole('heading', { name: 'Onboarding is confusing' })).toBeNull();
  });

  it('wears the pigment the author chose, not a theme colour', () => {
    const { container } = renderNode(sticky);
    // Author-picked colours are persisted on the object and rendered back as-is —
    // the rule `authoredColors.ts` states and the reason this is inline style.
    expect((container.querySelector('article') as HTMLElement).style.background).toContain('253, 230, 138');
  });

  it('writes what is typed back to the title, because the title IS the text', () => {
    const onEditData = vi.fn();
    renderNode({ ...sticky, title: '' }, { onEditData });
    fireEvent.change(screen.getByLabelText('Sticky note text'), { target: { value: 'Ship the import' } });
    expect(onEditData).toHaveBeenCalledWith('object-1', { title: 'Ship the import' });
  });

  it('is read-only, and says it is empty, when the board cannot be edited', () => {
    // No `onEditData` is how a viewer-role board arrives. A textarea there would
    // accept keystrokes it could never save.
    renderNode({ ...sticky, title: '' });
    expect(screen.queryByLabelText('Sticky note text')).toBeNull();
    expect(screen.getByText('Empty note')).toBeTruthy();
  });
});
