expect(updated.title).toBe('Child v2');
    expect(updated.status).toBe(TaskStatus.IN_PROGRESS);
    expect(updated.priority).toBe(TaskPriority.URGENT);
    expect(updated.assignedAgentRef).toBe('ide-agent-44');
    expect(updated.parentTaskId).toBe((epic.id + 2) as TaskId);
  });
});

describe('Task.update() broader semantic guards', () => {
  it('AC-6: concurrent updates targeting different fields should both persist correctly (no reset)', async () => {
    const { repo, service } = makeService();
    const epic = await service.createTask({ projectId: PROJECT_ID as number, title: 'Epic' }, TENANT);
    const child = await service.createTask(
      {
        projectId: PROJECT_ID as number,
        title: 'Child',
        parentTaskId: epic.id as number,
        assignedAgentRef: 'ide-agent-77',
        status: TaskStatus.IN_PROGRESS,
      },
      TENANT,
    );
    const originalParent = child.parentTaskId as number;
    const originalAgent = child.assignedAgentRef;

    // Concurrent updates on the same child via different paths; they do not see each other's writes
    // in a deterministic in-memory test so we simulate the outcome by asserting both fields end up correct
    // without reintroducing a partial-reset bug.
    const [updated1, updated2] = await Promise.all([
      service.updateTask(child.id as number, { assignedAgentRef: 'ide-agent-88' }),
      service.updateTask(child.id as number, { parentTaskId: (epic.id + 3) as number }),
    ]);

    expect(updated1.assignedAgentRef).toBe('ide-agent-88');
    expect(updated2.parentTaskId).toBe((epic.id + 3) as TaskId);
    // Neither update should clobber the other's field due to the undefined/null guard in updateTask
    const persisted = await repo.findById(child.id as TaskId);
    expect(persisted?.assignedAgentRef).toBe('ide-agent-88');
    expect(persisted?.parentTaskId).toBe((epic.id + 3) as TaskId);
  });

  it('FR-6: updating with invalid assignedAgentRef format raises validation error (unchanged from original)', async () => {
    const { service } = makeService();
    const epic = await service.createTask({ projectId: PROJECT_ID as number, title: 'Epic' }, TENANT);
    const child = await service.createTask(
      {
        projectId: PROJECT_ID as number,
        title: 'Child',
        parentTaskId: epic.id as number,
        assignedAgentRef: 'ide-agent-55',
      },
      TENANT,
    );
    const oldAgent = child.assignedAgentRef;

    await expect(
      service.updateTask(child.id as number, { assignedAgentRef: 'not-a-ref' as any }),
    ).rejects.toThrow(/Validation|invalid|ref/);

    // The task should remain unchanged since the validation failed before persistence
    const persisted = await service.getTask(child.id as number);
    expect(persisted.assignedAgentRef).toBe(oldAgent);
  });
});