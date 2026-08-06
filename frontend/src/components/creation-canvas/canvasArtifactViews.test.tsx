import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CreationNode } from './CreationNode';
import { CanvasFilesPanel } from './CanvasFilesPanel';
import { canvasFiles } from '@/lib/canvasDocuments';
import type { CreationNodeData } from './types';

/**
 * The regression these cover: a researched document, a generated deck, and a
 * Draw.io diagram all rendered as one line of grey placeholder text, and there
 * was nowhere to see the files a session had actually produced.
 */

/** The real catalogs, resolved the way next-intl resolves them — including the
 * `plural` forms the file-count and slide-count labels are written in, so these
 * assert the string a person actually reads. */
vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-intl')>();
  const messages = (await import('@/i18n/messages/en.json')).default as Record<string, unknown>;
  const PLURAL = /\{(\w+),\s*plural,\s*one \{([^}]*)\} other \{([^}]*)\}\}/g;
  return {
    ...actual,
    useTranslations: (namespace?: string) => (key: string, values?: Record<string, unknown>) => {
      const path = (namespace ? `${namespace}.${key}` : key).split('.');
      const value = path.reduce<unknown>((current, segment) => current && typeof current === 'object'
        ? (current as Record<string, unknown>)[segment]
        : undefined, messages);
      const copy = typeof value === 'string' ? value : namespace ? `${namespace}.${key}` : key;
      const pluralized = copy.replace(PLURAL, (_match, name: string, one: string, other: string) => {
        const count = Number(values?.[name]);
        return (count === 1 ? one : other).replace('#', String(count));
      });
      return Object.entries(values ?? {}).reduce((result, [name, replacement]) => result.replaceAll(`{${name}}`, String(replacement)), pluralized);
    },
  };
});

vi.mock('@xyflow/react', async () => {
  const inert = () => null;
  return { Handle: inert, NodeResizer: inert, Position: { Left: 'left', Right: 'right' } };
});

const nodeProps = {
  id: 'object-1', type: 'creation' as const, selected: false, dragging: false, zIndex: 0,
  selectable: true, deletable: true, draggable: true, isConnectable: true,
  positionAbsoluteX: 0, positionAbsoluteY: 0,
};

const renderNode = (data: CreationNodeData, overrides: Partial<React.ComponentProps<typeof CreationNode>> = {}) =>
  render(<CreationNode {...nodeProps} data={data} {...overrides} />);

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
