/**
 * Tests for distributed task engine
 */

import { describe, it, expect, beforeEach } from "vitest";
import { DistributedTaskEngine, MemoryTaskStorage } from "./task-engine.js";
import type { TaskSubmitRequest, TaskUpdateEvent } from "./types.js";

describe("DistributedTaskEngine", () => {
  let engine: DistributedTaskEngine;

  beforeEach(() => {
    engine = new DistributedTaskEngine(new MemoryTaskStorage());
  });

  describe("createTask", () => {
    it("should create a task with unique ID", async () => {
      const request: TaskSubmitRequest = {
        description: "Test task",
        input: "Do something",
      };

      const task = await engine.createTask(request);

      expect(task.id).toBeDefined();
      expect(task.status).toBe("pending");
      expect(task.description).toBe("Test task");
      expect(task.createdAt).toBeInstanceOf(Date);
    });

    it("should create multiple tasks with different IDs", async () => {
      const task1 = await engine.createTask({
        description: "Task 1",
        input: "Input 1",
      });

      const task2 = await engine.createTask({
        description: "Task 2",
        input: "Input 2",
      });

      expect(task1.id).not.toBe(task2.id);
    });
  });

  describe("updateTaskStatus", () => {
    it("should update task status to valid state", async () => {
      const task = await engine.createTask({
        description: "Test",
        input: "Test",
      });

      const updated = await engine.updateTaskStatus(task.id, "planning");
      expect(updated?.status).toBe("planning");
    });

    it("should reject invalid state transitions", async () => {
      const task = await engine.createTask({
        description: "Test",
        input: "Test",
      });

      await expect(engine.updateTaskStatus(task.id, "completed")).rejects.toThrow(
        /Invalid status transition/,
      );
    });

    it("should set timestamps on status changes", async () => {
      const task = await engine.createTask({
        description: "Test",
        input: "Test",
      });

      await engine.updateTaskStatus(task.id, "planning");
      const planningTask = await engine.getTask(task.id);
      expect(planningTask?.startedAt).toBeInstanceOf(Date);

      await engine.updateTaskStatus(task.id, "running");
      await engine.updateTaskStatus(task.id, "completed");
      const completedTask = await engine.getTask(task.id);
      expect(completedTask?.completedAt).toBeInstanceOf(Date);
    });
  });

  describe("updateTaskProgress", () => {
    it("should update task progress", async () => {
      const task = await engine.createTask({
        description: "Test",
        input: "Test",
      });

      await engine.updateTaskProgress(task.id, 50);
      const updated = await engine.getTask(task.id);
      expect(updated?.progress).toBe(50);
    });

    it("should clamp progress between 0 and 100", async () => {
      const task = await engine.createTask({
        description: "Test",
        input: "Test",
      });

      await engine.updateTaskProgress(task.id, 150);
      const updated1 = await engine.getTask(task.id);
      expect(updated1?.progress).toBe(100);

      await engine.updateTaskProgress(task.id, -10);
      const updated2 = await engine.getTask(task.id);
      expect(updated2?.progress).toBe(0);
    });
  });

  describe("setTaskOutput", () => {
    it("should set task output", async () => {
      const task = await engine.createTask({
        description: "Test",
        input: "Test",
      });

      await engine.setTaskOutput(task.id, "Task output");
      const updated = await engine.getTask(task.id);
      expect(updated?.output).toBe("Task output");
    });
  });

  describe("setTaskError", () => {
    it("should set task error and transition to failed", async () => {
      const task = await engine.createTask({
        description: "Test",
        input: "Test",
      });

      await engine.setTaskError(task.id, "Something went wrong");
      const updated = await engine.getTask(task.id);
      expect(updated?.error).toBe("Something went wrong");
      expect(updated?.status).toBe("failed");
      expect(updated?.completedAt).toBeInstanceOf(Date);
    });
  });

  describe("cancelTask", () => {
    it("should cancel a pending task", async () => {
      const task = await engine.createTask({
        description: "Test",
        input: "Test",
      });

      const cancelled = await engine.cancelTask(task.id);
      expect(cancelled).toBe(true);

      const updated = await engine.getTask(task.id);
      expect(updated?.status).toBe("cancelled");
    });

    it("should not cancel a completed task", async () => {
      const task = await engine.createTask({
        description: "Test",
        input: "Test",
      });

      await engine.updateTaskStatus(task.id, "planning");
      await engine.updateTaskStatus(task.id, "running");
      await engine.updateTaskStatus(task.id, "completed");

      const cancelled = await engine.cancelTask(task.id);
      expect(cancelled).toBe(false);

      const updated = await engine.getTask(task.id);
      expect(updated?.status).toBe("completed");
    });
  });

  describe("listTasks", () => {
    it("should list all tasks", async () => {
      await engine.createTask({ description: "Task 1", input: "Input 1" });
      await engine.createTask({ description: "Task 2", input: "Input 2" });

      const tasks = await engine.listTasks();
      expect(tasks).toHaveLength(2);
    });

    it("should filter tasks by status", async () => {
      const task1 = await engine.createTask({ description: "Task 1", input: "Input 1" });
      const task2 = await engine.createTask({ description: "Task 2", input: "Input 2" });

      await engine.updateTaskStatus(task1.id, "planning");

      const pendingTasks = await engine.listTasks({ status: "pending" });
      expect(pendingTasks).toHaveLength(1);
      expect(pendingTasks[0].id).toBe(task2.id);
    });

    it("should filter tasks by session ID", async () => {
      await engine.createTask({
        description: "Task 1",
        input: "Input 1",
        sessionId: "session-1",
      });
      await engine.createTask({
        description: "Task 2",
        input: "Input 2",
        sessionId: "session-2",
      });

      const sessionTasks = await engine.listTasks({ sessionId: "session-1" });
      expect(sessionTasks).toHaveLength(1);
      expect(sessionTasks[0].description).toBe("Task 1");
    });
  });

  describe("getTaskEvents", () => {
    it("should track task events", async () => {
      const task = await engine.createTask({
        description: "Test",
        input: "Test",
      });

      await engine.updateTaskStatus(task.id, "planning");
      await engine.updateTaskStatus(task.id, "running");
      await engine.updateTaskProgress(task.id, 50);

      const events = await engine.getTaskEvents(task.id);
      expect(events.length).toBeGreaterThanOrEqual(4); // created + 2 status changes + progress
      expect(events[0].event).toBe("created");
    });
  });

  describe("subscribeToTask", () => {
    it("should notify subscribers of updates", async () => {
      const task = await engine.createTask({
        description: "Test",
        input: "Test",
      });

      const updates: TaskUpdateEvent[] = [];
      const unsubscribe = engine.subscribeToTask(task.id, (event) => {
        updates.push(event);
      });

      await engine.updateTaskStatus(task.id, "planning");
      await engine.updateTaskProgress(task.id, 50);

      unsubscribe();

      expect(updates.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("streamTaskUpdates", () => {
    it("should stream task updates", async () => {
      const task = await engine.createTask({
        description: "Test",
        input: "Test",
      });

      const updates: TaskUpdateEvent[] = [];
      const streamPromise = (async () => {
        for await (const update of engine.streamTaskUpdates(task.id)) {
          updates.push(update);
          if (update.status === "completed") {
            break;
          }
        }
      })();

      // Allow initial state to be yielded
      await new Promise((resolve) => setTimeout(resolve, 10));

      await engine.updateTaskStatus(task.id, "planning");
      await engine.updateTaskStatus(task.id, "running");
      await engine.updateTaskStatus(task.id, "completed");

      await streamPromise;

      expect(updates.length).toBeGreaterThanOrEqual(1);
      expect(updates[updates.length - 1].status).toBe("completed");
    });
  });
});
