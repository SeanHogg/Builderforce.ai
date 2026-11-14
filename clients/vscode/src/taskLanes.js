import { isClosedTaskStatus } from "@builderforce/agent-loop";
const lane = (key, label) => ({ key, label, closed: isClosedTaskStatus(key) });
export const TASK_LANES = [
    lane("backlog", "Backlog"),
    lane("todo", "To do"),
    lane("ready", "Ready"),
    lane("in_progress", "In progress"),
    lane("in_review", "In review"),
    lane("blocked", "Blocked"),
    lane("done", "Done"),
    lane("cancelled", "Cancelled"),
];
export const TASK_LANE_KEYS = new Set(TASK_LANES.map((l) => l.key));
//# sourceMappingURL=taskLanes.js.map