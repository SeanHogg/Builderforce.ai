import { describe, it, expect, vi } from 'vitest';
import {
  countAssigneeFields,
  resolveDefaultCreateTaskAssignee,
} from './resolveCreateTaskAssignee';

const exists = (ids: ReadonlySet<string> | string[]) => {
  const set = ids instanceof Set ? ids : new Set(ids);
  return vi.fn(async (id: string) => set.has(id));
};

describe('countAssigneeFields', () => {
  it('counts only non-null coordinator columns', () => {
    expect(countAssigneeFields({
      assignedUserId: null, assignedAgentRef: null, assignedAgentHostId: null,
    })).toBe(0);
    expect(countAssigneeFields({
      assignedUserId: 'u1', assignedAgentRef: null, assignedAgentHostId: null,
    })).toBe(1);
    expect(countAssigneeFields({
      assignedUserId: 'u1', assignedAgentRef: 'ada', assignedAgentHostId: null,
    })).toBe(2);
  });
});

describe('resolveDefaultCreateTaskAssignee', () => {
  it('managerRef null / system → no requesting user → all-null (no FK sentinel)', async () => {
    const userExists = exists([]);
    await expect(resolveDefaultCreateTaskAssignee({
      managerRef: null,
      requestingUserId: null,
      userExists,
    })).resolves.toEqual({
      assignedUserId: null,
      assignedAgentRef: null,
      assignedAgentHostId: null,
    });
    expect(userExists).not.toHaveBeenCalled();
  });

  it('managerRef null + dangling requesting human → all-null, not the dangling id', async () => {
    const userExists = exists([]);
    await expect(resolveDefaultCreateTaskAssignee({
      managerRef: null,
      requestingUserId: 'dangling-user',
      userExists,
    })).resolves.toEqual({
      assignedUserId: null,
      assignedAgentRef: null,
      assignedAgentHostId: null,
    });
    expect(userExists).toHaveBeenCalledWith('dangling-user');
  });

  it('managerRef null + requesting human who exists → that user', async () => {
    const userExists = exists(['user-owner']);
    await expect(resolveDefaultCreateTaskAssignee({
      managerRef: null,
      requestingUserId: 'user-owner',
      userExists,
    })).resolves.toEqual({
      assignedUserId: 'user-owner',
      assignedAgentRef: null,
      assignedAgentHostId: null,
    });
  });

  it('u: manager that exists is assigned', async () => {
    const userExists = exists(['mgr-1']);
    await expect(resolveDefaultCreateTaskAssignee({
      managerRef: 'u:mgr-1',
      requestingUserId: 'someone-else',
      userExists,
    })).resolves.toEqual({
      assignedUserId: 'mgr-1',
      assignedAgentRef: null,
      assignedAgentHostId: null,
    });
    expect(userExists).toHaveBeenCalledWith('mgr-1');
  });

  it('dangling u: manager + existing requesting human → the requesting human', async () => {
    const userExists = exists(['user-owner']);
    await expect(resolveDefaultCreateTaskAssignee({
      managerRef: 'u:ghost',
      requestingUserId: 'user-owner',
      userExists,
    })).resolves.toEqual({
      assignedUserId: 'user-owner',
      assignedAgentRef: null,
      assignedAgentHostId: null,
    });
  });

  it('dangling u: manager + dangling requesting human → all-null, not either id', async () => {
    const userExists = exists([]);
    await expect(resolveDefaultCreateTaskAssignee({
      managerRef: 'u:ghost',
      requestingUserId: 'dangling-user',
      userExists,
    })).resolves.toEqual({
      assignedUserId: null,
      assignedAgentRef: null,
      assignedAgentHostId: null,
    });
  });

  it('c: cloud-agent manager is passed through without a users lookup', async () => {
    const userExists = exists([]);
    await expect(resolveDefaultCreateTaskAssignee({
      managerRef: 'c:ada',
      requestingUserId: 'dangling-user',
      userExists,
    })).resolves.toEqual({
      assignedUserId: null,
      assignedAgentRef: 'ada',
      assignedAgentHostId: null,
    });
    expect(userExists).not.toHaveBeenCalled();
  });

  it('blank managerRef is treated as system (no assignee)', async () => {
    await expect(resolveDefaultCreateTaskAssignee({
      managerRef: '   ',
      requestingUserId: undefined,
      userExists: exists([]),
    })).resolves.toEqual({
      assignedUserId: null,
      assignedAgentRef: null,
      assignedAgentHostId: null,
    });
  });
});
