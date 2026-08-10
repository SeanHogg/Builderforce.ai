import { describe, expect, it } from 'vitest';
import { visibleAssigneeFilters, type FilterableAssignee } from './TeamMemberAvatarFilter';

const assignees: FilterableAssignee[] = Array.from({ length: 10 }, (_, index) => ({
  key: `u:${index + 1}`,
  name: `Person ${index + 1}`,
  count: 10 - index,
}));

describe('visibleAssigneeFilters', () => {
  it('keeps a selected assignee visible even when it falls beyond the compact cap', () => {
    const visible = visibleAssigneeFilters(assignees, ['u:10']);
    expect(visible.map((assignee) => assignee.key)).toEqual([
      'u:10', 'u:1', 'u:2', 'u:3', 'u:4', 'u:5', 'u:6', 'u:7',
    ]);
  });

  it('preserves the ranked order when nothing is selected', () => {
    expect(visibleAssigneeFilters(assignees, []).map((assignee) => assignee.key))
      .toEqual(['u:1', 'u:2', 'u:3', 'u:4', 'u:5', 'u:6', 'u:7', 'u:8']);
  });

  it('keeps multiple active filters ahead of unselected assignees', () => {
    expect(visibleAssigneeFilters(assignees, ['u:9', 'u:10'], 3).map((assignee) => assignee.key))
      .toEqual(['u:9', 'u:10', 'u:1']);
  });
});
