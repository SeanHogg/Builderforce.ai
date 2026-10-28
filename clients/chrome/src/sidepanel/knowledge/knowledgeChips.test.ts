import { describe, expect, it, vi } from 'vitest';
import { rovrPrefetchLabelKey, rovrPrefetchTimeline } from './knowledgeChips';

const translate = (key: string) => `«${key}»`;

describe('Rovr knowledge chip routing', () => {
  it('opens the Knowledge tab focused on an Open-in-graph chip', () => {
    const open = vi.fn();
    const binding = rovrPrefetchTimeline(translate, open);
    binding.onChip!({ labelKey: 'prefetch.chip.openInGraph', command: 'builderforce.openKnowledgeGraph', args: { rootId: 'rovr:folder:docs', focus: ['src:rovr:folder:docs::a.md'] } });
    expect(open).toHaveBeenCalledWith({ review: false, focus: ['src:rovr:folder:docs::a.md'], rootId: 'rovr:folder:docs' });
  });

  it('opens the Knowledge tab on its review launcher for a Choose-a-folder chip', () => {
    const open = vi.fn();
    rovrPrefetchTimeline(translate, open).onChip!({ labelKey: 'prefetch.chip.chooseFolderToReview', command: 'builderforce.openKnowledgeReview', args: { dir: 'docs' } });
    expect(open).toHaveBeenCalledWith({ review: true, focus: [], dir: 'docs' });
  });

  it('ignores a chip that is not a knowledge one', () => {
    const open = vi.fn();
    rovrPrefetchTimeline(translate, open).onChip!({ labelKey: 'x', command: 'builderforce.somethingElse' });
    expect(open).not.toHaveBeenCalled();
  });

  it('names the rows and chips in Rovr\'s catalog, and leaves the rest to the shared default', () => {
    const binding = rovrPrefetchTimeline(translate, vi.fn());
    expect(binding.labelOf!('prefetch.chip.openInGraph')).toBe('«prefetchOpenInGraph»');
    expect(binding.labelOf!('prefetch.action.knowledge.review-dir')).toBe('«prefetchActionKnowledgeReview»');
    expect(binding.labelOf!('prefetch.action.lint.fix')).toBeUndefined();
    expect(rovrPrefetchLabelKey('prefetch.action.knowledge.ask')).toBe('prefetchActionKnowledgeAsk');
    expect(binding.labels).toMatchObject({ answeredBy: '«prefetchAnsweredBy»', nextSteps: '«prefetchNextSteps»' });
  });
});
