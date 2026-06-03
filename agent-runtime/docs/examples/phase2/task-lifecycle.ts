/**
 * Example: Distributed Task Lifecycle
 */

import { DistributedTaskEngine, MemoryTaskStorage } from "../../src/transport/task-engine.js";

async function main() {
  console.log("=== builderForceAgents Phase 2 Task Lifecycle Example ===\n");

  const taskEngine = new DistributedTaskEngine(new MemoryTaskStorage());

  // 1. Create multiple tasks
  console.log("1. Creating tasks...");
  const task1 = await taskEngine.createTask({
    description: "Analyze requirements",
    input: "Review project requirements",
    agentId: "architecture-advisor",
  });
  console.log(`   Task 1: ${task1.id} (${task1.status})`);

  const task2 = await taskEngine.createTask({
    description: "Implement feature",
    input: "Build the feature based on requirements",
    agentId: "code-creator",
    parentTaskId: task1.id,
  });
  console.log(`   Task 2: ${task2.id} (${task2.status})`);

  const task3 = await taskEngine.createTask({
    description: "Write tests",
    input: "Create comprehensive test suite",
    agentId: "test-generator",
    parentTaskId: task2.id,
  });
  console.log(`   Task 3: ${task3.id} (${task3.status})\n`);

  // 2. Demonstrate state machine transitions
  console.log("2. Executing task 1...");
  await taskEngine.updateTaskStatus(task1.id, "planning");
  console.log(`   Status: planning`);

  await new Promise((resolve) => setTimeout(resolve, 100));
  await taskEngine.updateTaskStatus(task1.id, "running");
  console.log(`   Status: running`);

  await taskEngine.updateTaskProgress(task1.id, 50);
  console.log(`   Progress: 50%`);

  await taskEngine.updateTaskProgress(task1.id, 100);
  console.log(`   Progress: 100%`);

  await taskEngine.setTaskOutput(task1.id, "Requirements analyzed successfully");
  await taskEngine.updateTaskStatus(task1.id, "completed");
  console.log(`   Status: completed\n`);

  // 3. Execute task 2
  console.log("3. Executing task 2...");
  await taskEngine.updateTaskStatus(task2.id, "planning");
  await taskEngine.updateTaskStatus(task2.id, "running");
  await taskEngine.updateTaskProgress(task2.id, 30);
  console.log(`   Progress: 30%`);

  // Simulate waiting state
  await taskEngine.updateTaskStatus(task2.id, "waiting");
  console.log(`   Status: waiting (external input required)`);

  await new Promise((resolve) => setTimeout(resolve, 100));

  // Resume execution
  await taskEngine.updateTaskStatus(task2.id, "running");
  console.log(`   Status: running (resumed)`);

  await taskEngine.updateTaskProgress(task2.id, 100);
  await taskEngine.setTaskOutput(task2.id, "Feature implemented");
  await taskEngine.updateTaskStatus(task2.id, "completed");
  console.log(`   Status: completed\n`);

  // 4. Simulate task 3 failure
  console.log("4. Executing task 3 (with failure)...");
  await taskEngine.updateTaskStatus(task3.id, "planning");
  await taskEngine.updateTaskStatus(task3.id, "running");
  await taskEngine.updateTaskProgress(task3.id, 20);
  console.log(`   Progress: 20%`);

  await taskEngine.setTaskError(task3.id, "Test framework configuration error");
  console.log(`   Status: failed (${(await taskEngine.getTask(task3.id))?.error})\n`);

  // 5. List all tasks
  console.log("5. Listing all tasks:");
  const allTasks = await taskEngine.listTasks();
  allTasks.forEach((task) => {
    console.log(`   - ${task.description}`);
    console.log(`     ID: ${task.id}`);
    console.log(`     Status: ${task.status}`);
    if (task.progress !== undefined) {
      console.log(`     Progress: ${task.progress}%`);
    }
    if (task.output) {
      console.log(`     Output: ${task.output}`);
    }
    if (task.error) {
      console.log(`     Error: ${task.error}`);
    }
  });
  console.log();

  // 6. List only completed tasks
  console.log("6. Listing completed tasks:");
  const completedTasks = await taskEngine.listTasks({ status: "completed" });
  console.log(`   Found ${completedTasks.length} completed tasks`);
  completedTasks.forEach((task) => {
    console.log(`   - ${task.description} (${task.id})`);
  });
  console.log();

  // 7. Get task event history
  console.log("7. Task 2 event history:");
  const events = await taskEngine.getTaskEvents(task2.id);
  events.forEach((event) => {
    console.log(`   [${event.timestamp.toISOString()}] ${event.event}: ${event.message || ""}`);
  });
  console.log();

  // 8. Demonstrate task cancellation
  console.log("8. Creating and cancelling a task...");
  const task4 = await taskEngine.createTask({
    description: "Long-running task",
    input: "This will be cancelled",
    agentId: "general-purpose",
  });

  await taskEngine.updateTaskStatus(task4.id, "planning");
  await taskEngine.updateTaskStatus(task4.id, "running");
  console.log(`   Task 4 created and running`);

  const cancelled = await taskEngine.cancelTask(task4.id);
  console.log(`   Task 4 cancelled: ${cancelled}`);

  const cancelledTask = await taskEngine.getTask(task4.id);
  console.log(`   Status: ${cancelledTask?.status}\n`);

  // 9. Demonstrate invalid state transition
  console.log("9. Testing invalid state transition...");
  const task5 = await taskEngine.createTask({
    description: "Test task",
    input: "Testing state machine",
    agentId: "general-purpose",
  });

  try {
    // Try to go directly from pending to completed (invalid)
    await taskEngine.updateTaskStatus(task5.id, "completed");
    console.log("   ERROR: Invalid transition was allowed!");
  } catch (error) {
    console.log(`   ✓ Invalid transition blocked: ${error.message}\n`);
  }

  console.log("Example complete!");
}

main().catch(console.error);
