import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CreationNode } from './CreationNode';
import { creationObjectAiContext, creationObjectDefinition, sanitizeCreationObjectPatch } from './creationObjectRegistry';
import { CREATION_TEMPLATES } from './creationTemplates';
import { canvasExportActionsFor } from './CanvasExportActions';
import type { CreationNodeData } from './types';

/**
 * What these hold in place: a pitch card must lead with the verdict — over time,
 * under-scored, unrehearsed, not submittable — because that verdict is the whole
 * reason the object exists. A card that renders its title and a status pill is
 * indistinguishable from a note.
 */

/** The real catalogs, resolved the way next-intl resolves them, including the
 * `has` probe the seeded-label lookup depends on. */
vi.mock('next-intl', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next-intl')>()),
  useTranslations: (await import('@/test/realCatalogTranslations')).realCatalogTranslator(
    (await import('@/i18n/messages/en.json')).default as Record<string, unknown>,
  ),
}));

vi.mock('@xyflow/react', async () => {
  const inert = () => null;
  return {
    Handle: inert, NodeResizer: inert, Position: { Left: 'left', Right: 'right' },
    useStore: (selector: (state: { nodeLookup: Map<string, unknown> }) => unknown) => selector({ nodeLookup: new Map() }),
  };
});

const nodeProps = {
  id: 'object-1', type: 'creation' as const, selected: false, dragging: false, zIndex: 0,
  selectable: true, deletable: true, draggable: true, isConnectable: true,
  positionAbsoluteX: 0, positionAbsoluteY: 0,
};

const renderNode = (data: CreationNodeData) => render(<CreationNode {...nodeProps} data={data} />);

describe('the pitch card', () => {
  it('opens on the competition outline rather than an empty card', () => {
    renderNode({ kind: 'pitch', title: 'Competition pitch', competitionId: 'sxsw-pitch' });
    expect(screen.getByText('of 3:00 allowed')).toBeTruthy();
    expect(screen.getByText('0/8 beats written')).toBeTruthy();
    expect(screen.getByText('Hook')).toBeTruthy();
    expect(screen.getByText('Ask')).toBeTruthy();
  });

  it('shows the SPOKEN runtime, so a script that overruns its budget is visible', () => {
    renderNode({
      kind: 'pitch', title: 'Competition pitch', competitionId: 'sxsw-pitch',
      beats: [{ id: 'hook', seconds: 20, script: Array.from({ length: 520 }, () => 'word').join(' ') }],
    });
    // 520 words at 130 wpm is four minutes, against a three-minute limit.
    expect(screen.getByText('4:00')).toBeTruthy();
    expect(document.querySelector('[data-tone="risk"]')).toBeTruthy();
  });

  it('translates a seeded beat but leaves a renamed one exactly as written', () => {
    renderNode({ kind: 'pitch', title: 'Pitch', beats: [{ id: 'hook', label: 'The Netflix moment', seconds: 20 }] });
    expect(screen.getByText('The Netflix moment')).toBeTruthy();
    expect(screen.queryByText('Hook')).toBeNull();
  });
});

describe('the scorecard', () => {
  it('reads an unscored rubric as not ready and names where marks are lost', () => {
    renderNode({ kind: 'pitchScorecard', title: 'Judging scorecard', competitionId: 'sxsw-pitch' });
    expect(screen.getByText('0%')).toBeTruthy();
    expect(screen.getByText('6 criteria')).toBeTruthy();
    expect(screen.getByText('Marks lost here')).toBeTruthy();
    // Once in the rubric, once again in the "marks lost here" summary.
    expect(screen.getAllByText('Innovation / originality')).toHaveLength(2);
  });

  it('weights the score rather than averaging it', () => {
    renderNode({
      kind: 'pitchScorecard', title: 'Scorecard', competitionId: 'demo-day',
      criteria: [{ id: 'solution', weight: 3, score: 5 }, { id: 'team', weight: 1, score: 1 }],
    });
    expect(screen.getByText('80%')).toBeTruthy();
  });
});

describe('the judge Q&A drill', () => {
  it('seeds itself from the rubric and reports rehearsal coverage', () => {
    renderNode({ kind: 'pitchQa', title: 'Judge Q&A drill', competitionId: 'sxsw-pitch' });
    expect(screen.getByText('0%')).toBeTruthy();
    expect(screen.getByText('0 of 6 answered')).toBeTruthy();
    expect(screen.getAllByText('Not rehearsed yet.')).toHaveLength(6);
  });
});

describe('the competition entry', () => {
  it('refuses to read as submittable while a rule is unmet', () => {
    renderNode({ kind: 'pitchApplication', title: 'Competition entry', competitionId: 'sxsw-pitch' });
    expect(screen.getByText('6 blockers')).toBeTruthy();
    expect(screen.getByText(/Under \$10M raised in combined funding/)).toBeTruthy();
    expect(screen.queryByText('Ready to submit')).toBeNull();
  });

  it('flags an over-length answer, which is what gets an entry thrown out', () => {
    renderNode({
      kind: 'pitchApplication', title: 'Entry',
      answers: [{ id: 'oneLiner', maxChars: 10, answer: 'far too long to fit' }],
    });
    expect(screen.getByText('19 / 10 characters')).toBeTruthy();
    expect(document.querySelector('[data-over="true"]')).toBeTruthy();
  });

  it('says plainly when everything is done', () => {
    renderNode({
      kind: 'pitchApplication', title: 'Entry',
      eligibility: [{ id: 'fundingCap', met: true }],
      answers: [{ id: 'oneLiner', maxChars: 140, answer: 'One clear sentence.' }],
    });
    expect(screen.getByText('Ready to submit')).toBeTruthy();
  });
});

describe('the pitch objects are first-class canvas objects', () => {
  const kinds = ['pitch', 'pitchScorecard', 'pitchQa', 'pitchApplication'] as const;

  it('are grouped together in the palette and carry their own actions', () => {
    kinds.forEach((kind) => {
      const definition = creationObjectDefinition(kind);
      expect(definition.group).toBe('Pitch');
      expect(definition.actions).toContain('export');
    });
  });

  it('export as documents rather than as JSON', () => {
    kinds.forEach((kind) => {
      expect(canvasExportActionsFor(creationObjectDefinition(kind).createData())).toContain('docx');
    });
  });

  it('reach Brain with the arrays that hold their substance', () => {
    const context = creationObjectAiContext({
      kind: 'pitchScorecard', title: 'Scorecard', competitionId: 'sxsw-pitch',
      criteria: [{ id: 'innovation', score: 2, gap: 'No third-party benchmark yet' }],
    });
    expect(context.competitionId).toBe('sxsw-pitch');
    expect(context.criteria).toHaveLength(1);
  });

  it('accept a Brain-authored patch on their own fields and reject everything else', () => {
    const patch = sanitizeCreationObjectPatch('pitch', { beats: [{ id: 'hook', script: 'x' }], apiKey: 'secret', nonsense: 1 });
    expect(patch.beats).toHaveLength(1);
    expect(patch.apiKey).toBeUndefined();
    expect(patch.nonsense).toBeUndefined();
  });

  it('ship a pack that puts the whole competition on one board', () => {
    const template = CREATION_TEMPLATES.find((candidate) => candidate.id === 'pitch-competition')!;
    expect(template).toBeTruthy();
    expect(template.objects.map((object) => object.kind)).toEqual(
      expect.arrayContaining(['pitchApplication', 'pitch', 'pitchScorecard', 'pitchQa']),
    );
  });
});
