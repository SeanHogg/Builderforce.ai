import { describe, expect, it } from 'vitest';
import { newLocalCreationSessionSnapshot, projectCardObject } from './boardSnapshot';

describe('project card', () => {
  it('is the card the server makes for a board created with projectIds', () => {
    const card = projectCardObject({ id: 12, name: 'Apollo' });
    expect(card).toMatchObject({ type: 'creation', data: { kind: 'project', title: 'Apollo', resourceId: 'project:12' } });
  });

  it('seeds a board born in a project with the card, ahead of the chat object', () => {
    const { snapshot } = newLocalCreationSessionSnapshot('', undefined, { id: 12, name: 'Apollo' });
    expect(snapshot.nodes.map((node) => node.data.kind)).toEqual(['project', 'chat']);
  });

  it('seeds no card when the board is not in a project', () => {
    const { snapshot } = newLocalCreationSessionSnapshot('');
    expect(snapshot.nodes.map((node) => node.data.kind)).toEqual(['chat']);
  });
});
