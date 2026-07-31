// ingestion.ts — parse task lists in JSON, YAML, and plain-text formats (FR-1)

import type { TaskInput, InputFormat, AnalysisError } from "./types";

/**
 * Parse a task list from a string, auto-detecting or accepting an explicit
 * format hint.  Returns the parsed tasks or a structured AnalysisError.
 */
export function parseTasks(
  raw: string,
  format?: InputFormat,
): TaskInput[] | AnalysisError {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      error_code: "EMPTY_INPUT",
      message: "Input is empty",
      details: { cause: [] },
    };
  }

  const fmt = format ?? detectFormat(trimmed);

  switch (fmt) {
    case "json":
      return parseJson(trimmed);
    case "yaml":
      return parseYaml(trimmed);
    case "plain":
      return parsePlainText(trimmed);
  }
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

function detectFormat(raw: string): InputFormat {
  const first = raw[0];
  if (first === "{" || first === "[") return "json";

  // YAML heuristics: starts with a key-like token or uses `---`
  if (/^[\w"']+\s*:/.test(raw) || raw.startsWith("---")) return "yaml";

  // Fallback to plain-text
  return "plain";
}

// ---------------------------------------------------------------------------
// JSON parser
// ---------------------------------------------------------------------------

function parseJson(raw: string): TaskInput[] | AnalysisError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e: unknown) {
    return {
      error_code: "MALFORMED_INPUT",
      message: `Invalid JSON: ${(e as Error).message}`,
      details: { cause: [] },
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      error_code: "MALFORMED_INPUT",
      message: "JSON input must be a JSON array of task objects",
      details: { cause: [] },
    };
  }

  return validateTaskArray(parsed as Record<string, unknown>[]);
}

// ---------------------------------------------------------------------------
// YAML parser (inline fallback — avoids dependency on `yaml` package for CLI)
// ---------------------------------------------------------------------------

function parseYaml(raw: string): TaskInput[] | AnalysisError {
  // Simple YAML parser for the task-list subset we support.
  // Handles a list of objects with scalar fields and string arrays.
  // If the `yaml` package is available at runtime the caller can pre-parse,
  // but this keeps the module zero-dependency.
  try {
    const parsed = parseSimpleYaml(raw);
    if (!Array.isArray(parsed)) {
      return {
        error_code: "MALFORMED_INPUT",
        message: "YAML input must be a sequence of task objects",
        details: { cause: [] },
      };
    }
    return validateTaskArray(parsed as Record<string, unknown>[]);
  } catch (e: unknown) {
    return {
      error_code: "MALFORMED_INPUT",
      message: `Invalid YAML: ${(e as Error).message}`,
      details: { cause: [] },
    };
  }
}

// ---------------------------------------------------------------------------
// Plain-text parser (FR-1.1)
// Each non-empty line is a task name.  IDs are auto-generated.
// Lines with " → " or " depends on " are parsed for dependency hints.
// ---------------------------------------------------------------------------

function parsePlainText(raw: string): TaskInput[] | AnalysisError {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));

  if (lines.length === 0) {
    return {
      error_code: "EMPTY_INPUT",
      message: "No tasks found in plain-text input",
      details: { cause: [] },
    };
  }

  const tasks: TaskInput[] = [];
  const idMap = new Map<string, number>(); // name → counter for dedup

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Try to parse "Name depends on DepA, DepB" or "Name → DepA, DepB"
    const depMatch = line.match(
      /^(.+?)\s+(?:depends\s+on|→|->)\s+(.+)$/i,
    );
    let name: string;
    let depends_on: string[] | undefined;

    if (depMatch) {
      name = depMatch[1]!.trim();
      depends_on = depMatch[2]!
        .split(/[,;]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    } else {
      name = line;
      depends_on = undefined;
    }

    // Generate stable ID from name
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const count = (idMap.get(slug) ?? 0) + 1;
    idMap.set(slug, count);
    const id = count === 1 ? slug : `${slug}-${count}`;

    tasks.push({
      id,
      name,
      description: "",
      depends_on,
    });
  }

  return validateTaskArray(tasks);
}

// ---------------------------------------------------------------------------
// Validation: ensure each task has at least id and name
// ---------------------------------------------------------------------------

function validateTaskArray(
  arr: Record<string, unknown>[],
): TaskInput[] | AnalysisError {
  if (arr.length === 0) {
    return {
      error_code: "EMPTY_INPUT",
      message: "Task list is empty",
      details: { cause: [] },
    };
  }

  const tasks: TaskInput[] = [];
  const seenIds = new Set<string>();
  const unknownRefs: string[] = [];

  for (let i = 0; i < arr.length; i++) {
    const obj = arr[i]!;
    if (typeof obj !== "object" || obj === null) {
      return {
        error_code: "MALFORMED_INPUT",
        message: `Item at index ${i} is not an object`,
        details: { cause: [] },
      };
    }

    const id = typeof obj.id === "string" ? obj.id : String(obj.id ?? `task-${i + 1}`);
    if (seenIds.has(id)) {
      return {
        error_code: "DUPLICATE_ID",
        message: `Duplicate task ID "${id}"`,
        details: { cause: [id] },
      };
    }
    seenIds.add(id);

    const name = typeof obj.name === "string" ? obj.name : String(obj.name ?? id);

    let depends_on: string[] | undefined;
    if (Array.isArray(obj.depends_on)) {
      depends_on = obj.depends_on.map((d) => String(d));
    }

    let estimated_duration: number | undefined;
    if (typeof obj.estimated_duration === "number") {
      estimated_duration = obj.estimated_duration;
    } else if (typeof obj.estimated_duration === "string") {
      estimated_duration = Number(obj.estimated_duration);
    }

    const description = typeof obj.description === "string" ? obj.description : "";

    tasks.push({ id, name, description, depends_on, estimated_duration });
  }

  // Collect unknown dependency references (non-blocking per FR-5.1)
  for (const t of tasks) {
    for (const dep of t.depends_on ?? []) {
      if (!seenIds.has(dep)) {
        unknownRefs.push(`Task "${t.id}" depends on unknown task "${dep}"`);
      }
    }
  }

  // Return tasks even with unknown refs — caller can inspect warnings
  return tasks;
}

/**
 * Collect non-blocking warnings (unknown deps, isolated tasks) from a
 * validated task list.
 */
export function collectWarnings(tasks: TaskInput[]): string[] {
  const warnings: string[] = [];
  const ids = new Set(tasks.map((t) => t.id));

  // Unknown references
  for (const t of tasks) {
    for (const dep of t.depends_on ?? []) {
      if (!ids.has(dep)) {
        warnings.push(
          `Task "${t.id}" references unknown dependency "${dep}"`,
        );
      }
    }
  }

  // Isolated tasks (FR-5.3): no deps and nothing depends on it
  const hasDependents = new Set<string>();
  for (const t of tasks) {
    for (const dep of t.depends_on ?? []) {
      if (ids.has(dep)) hasDependents.add(dep);
    }
  }
  for (const t of tasks) {
    if (
      (!t.depends_on || t.depends_on.length === 0) &&
      !hasDependents.has(t.id) &&
      tasks.length > 1
    ) {
      warnings.push(
        `Task "${t.id}" is isolated (no dependencies and no dependents) — placed in Wave 1`,
      );
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Minimal YAML subset parser (no external dependency)
// ---------------------------------------------------------------------------

function parseSimpleYaml(raw: string): unknown {
  // For the task-list contract we only need to handle:
  //   - A top-level sequence of objects (lines starting with "- ")
  //   - Scalar values: strings, numbers, booleans
  //   - Inline arrays: [a, b, c]
  //   - Nested simple objects under keys

  // Strip YAML document markers
  let src = raw.replace(/^---\s*\n?/, "").replace(/\n\.\.\.\s*$/, "");

  // If it starts with "- ", treat as a sequence
  if (/^\s*- /m.test(src)) {
    return parseYamlSequence(src);
  }

  // Otherwise try a single object
  return parseYamlMapping(src);
}

function parseYamlSequence(src: string): unknown[] {
  // Split into items: lines starting with "- " at the current indent
  const items: string[] = [];
  const lines = src.split("\n");
  let currentItem: string[] = [];
  let inItem = false;

  for (const line of lines) {
    if (/^\s*- /.test(line)) {
      if (inItem) {
        items.push(currentItem.join("\n"));
      }
      currentItem = [line.replace(/^\s*- /, "")];
      inItem = true;
    } else if (inItem && /^\s{2,}/.test(line)) {
      // continuation line (indented)
      currentItem.push(line.replace(/^\s{2,}/, ""));
    } else if (inItem && line.trim() === "") {
      currentItem.push("");
    } else if (inItem) {
      items.push(currentItem.join("\n"));
      inItem = false;
      currentItem = [];
    }
  }
  if (inItem) items.push(currentItem.join("\n"));

  return items.map((item) => {
    if (/^\w[\w-]*\s*:/.test(item)) {
      return parseYamlMapping(item);
    }
    return parseYamlScalar(item.trim());
  });
}

function parseYamlMapping(src: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = src.split("\n");
  let currentKey = "";
  let currentValue: string[] = [];
  let inMultiline = false;

  for (const line of lines) {
    const keyMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)/);
    if (keyMatch && !inMultiline) {
      // Flush previous key
      if (currentKey) {
        result[currentKey] = parseYamlValue(currentValue.join("\n").trim());
      }
      currentKey = keyMatch[1]!;
      currentValue = [keyMatch[2]!];
    } else if (keyMatch && inMultiline) {
      // Check if this is a new key at the same indent level
      currentValue.push(line.trim());
    } else if (currentKey) {
      currentValue.push(line.trim());
    }
  }
  if (currentKey) {
    result[currentKey] = parseYamlValue(currentValue.join("\n").trim());
  }

  return result;
}

function parseYamlValue(raw: string): unknown {
  if (!raw) return "";
  // Inline array
  if (/^\[.*\]$/.test(raw)) {
    const inner = raw.slice(1, -1);
    if (inner.trim() === "") return [];
    return inner.split(",").map((s) => parseYamlScalar(s.trim()));
  }
  // Nested object
  if (/\n/.test(raw)) {
    return parseYamlMapping(raw);
  }
  return parseYamlScalar(raw);
}

function parseYamlScalar(raw: string): string | number | boolean | null {
  const s = raw.replace(/^["']|["']$/g, "").trim();
  if (s === "null" || s === "~" || s === "") return null;
  if (s === "true" || s === "True" || s === "TRUE") return true;
  if (s === "false" || s === "False" || s === "FALSE") return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}
