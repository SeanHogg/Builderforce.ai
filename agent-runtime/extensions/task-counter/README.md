# Task Counter Extension

Counts open tasks per project and estimates remaining effort using story points or T-shirt sizes.

## Overview

The Task Counter extension analyzes a list of tasks and produces:

- **Per-project task counts** (open + in_progress)
- **Total remaining effort** (in story points or T-shirt sizes)
- **Effort distribution** (tasks by size category)
- **Manual override support** for custom project-level estimates
- **Unestimated tracking** with configurable defaults

## Installation

The extension is included with BuilderForce Agents runtime. No additional installation steps are required.

## Configuration

Enable the plugin in your BuilderForce configuration (e.g., `agents` or `plugins` section):

```json5
{
  "pluginConfig": {
    "task-counter": {
      "defaultProvider": "openai-chat",
      "defaultModel": "gpt-4o",
      "effortMapping": {
        "S": 1,
        "M": 3,
        "L": 5,
        "XL": 8
      },
      "defaultUnestimatedEffort": 0.5,
      "manualOverrides": [
        {
          "project": "engineering-open-source",
          "override": 100
        }
      ],
      "includeDetails": false
    }
  }
}
```

### Configuration Parameters

| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `defaultProvider` | string | No | Default LLM provider (e.g., `"openai-chat"`) |
| `defaultModel` | string | No | Default model to use (e.g., `"gpt-4o"`) |
| `defaultAuthProfileId` | string | No | Default authentication profile to use |
| `allowedModels` | string[] | No | Allowlist of provider/model combinations |
| `maxTokens` | number | No | Maximum tokens for LLM calls |
| `timeoutMs` | number | No | Timeout for LLM calls (default: 30s) |
| `effortMapping` | object | No | T-shirt size to story points mapping |
| `defaultUnestimatedEffort` | number | No | Default story points for tasks without estimates (default: 0.5) |
| `manualOverrides` | object[] | No | Manual effort overrides per project |
| `includeDetails` | boolean | No | Whether to return per-project task details |

## Usage

The extension is a tool that can be called from workflows via `builderforce.invoke`.

### Workflow Example

```typescript
// Invoke the task counter from a workflow
const result = await fetch("/api/workflow", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    tool: "task-counter",
    params: {
      tasks: [
        {
          id: "T-1",
          project: "engineering-web",
          status: "open",
          effort: "M"
        },
        {
          id: "T-2",
          project: "engineering-web",
          status: "in_progress",
          effort: 5
        },
        {
          id: "T-3",
          project: "engineering-mobile",
          status: "open",
          effort: "L"
        }
      ],
      includeDetails: true
    }
  })
});

console.log(result);
// {
//   totalTasks: 3,
//   totalEffort: 9,
//   projects: [
//     {
//       "project": "engineering-web",
//       "taskCount": 2,
//       "totalEffort": 8,
//       "details": {
//         "taskIds": ["T-1", "T-2"],
//         "effortBySize": {
//           "M": 3,
//           "L": 5
//         }
//       }
//     },
//     {
//       "project": "engineering-mobile",
//       "taskCount": 1,
//       "totalEffort": 1,
//       "details": {
//         "taskIds": ["T-3"],
//         "effortBySize": {
//           "L": 1
//         }
//       }
//     }
//   ],
//   unestimatedTaskCount: 0
// }
```

### Using with LLM Tasks

You can also use this extension within an LLM Task to generate the task list automatically:

```json
{
  "tool": "llm-task",
  "params": {
    "prompt": "List all open tasks from my Jira board with their project and effort (story points or T-shirt size). Return JSON array.",
    "schema": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string" },
          "project": { "type": "string" },
          "status": { "type": "string", "enum": ["open", "in_progress"] },
          "effort": { "oneOf": [{ "type": "number" }, { "type": "string" }] }
        },
        "required": ["id", "project", "status"]
      }
    }
  }
}
```

Then call `task-counter` with the LLM output to aggregate results:

```json
{
  "tool": "task-counter",
  "params": {
    "tasks": <result from llm-task>,
    "includeDetails": true
  }
}
```

## Effort Units

### Story Points (Numeric)

Tasks with numeric effort values use story points directly:

```json
{
  "id": "T-1",
  "project": "engineering",
  "status": "open",
  "effort": 8
}
```

### T-Shirt Sizes

Tasks with string effort values are mapped using the `effortMapping` configuration. Example: `"S"`, `"M"`, `"L"`, `"XL"`.

```json
{
  "id": "T-2",
  "project": "engineering",
  "status": "in_progress",
  "effort": "M"
}
```

## Manual Overrides

Provide manual effort overrides for specific projects to override automatic calculations:

```json
{
  "pluginConfig": {
    "task-counter": {
      "manualOverrides": [
        { "project": "legacy-system", "override": 50 },
        { "project": "R&D-project", "override": 100 }
      ]
    }
  }
}
```

## Error Handling

The tool validates all responses against a schema. Common errors:

- **Schema validation fails**: Response structure mismatches expected format (e.g., missing required fields).
- **Empty input**: No tasks provided (returns 0 totals).
- **Invalid effort type**: Non-numeric effort string not in `effortMapping` requires unestimated handling.

## Concurrency

The tool is stateless and designed for parallel execution across tasks/projects. Each invocation processes a fresh task list independently.

## Security

The tool does not write or read tokens. It only processes task data passed via `params.tasks`. Configuration values are scoped to the tool and not exposed in responses.

## Changelog

### 1.0.0 (Initial)

- Initial release
- Story point and T-shirt size support
- Manual override and default unestimated effort
- Project-level aggregation with details export
- Schema validation for safe integration