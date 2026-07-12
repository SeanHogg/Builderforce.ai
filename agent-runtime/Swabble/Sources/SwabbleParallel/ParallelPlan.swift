public import Foundation

// MARK: - Data Models

/// Task model for parallelization planning.
public struct ParallelTask: Identifiable, Equatable, Sendable {
  public let id: String
  public let name: String
  public let description: String?
  public var dependsOn: [String]
  public var estimatedDuration: Int? // minutes

  public init(
    id: String,
    name: String,
    description: String? = nil,
    dependsOn: [String] = [],
    estimatedDuration: Int? = nil
  ) {
    self.id = id
    self.name = name
    self.description = description
    self.dependsOn = dependsOn
    self.estimatedDuration = estimatedDuration
  }
}

/// Parallelization plan wave.
public struct ParallelWave: Identifiable, Equatable, Sendable {
  public let waveNumber: Int
  public let tasks: [ParallelTask]

  public init(waveNumber: Int, tasks: [ParallelTask] = []) {
    self.waveNumber = waveNumber
    self.tasks = tasks
  }
}

/// Dependency graph representation.
public struct DependencyGraph: Sendable {
  public let nodes: [ParallelTask]
  public let edges: [(fromId: String, toId: String)]

  public init(nodes: [ParallelTask], edges: [(String, String)] = []) {
    self.nodes = nodes
    self.edges = edges
  }
}

/// Rendered parallelization plan.
public struct ParallelPlanRender: Sendable {
  public let waves: [ParallelWave]
  public let graph: DependencyGraph
  public let metadata: PlanMetadata

  public init(
    waves: [ParallelWave],
    graph: DependencyGraph,
    metadata: PlanMetadata
  ) {
    self.waves = waves
    self.graph = graph
    self.metadata = metadata
  }
}

/// Plan output metadata.
public struct PlanMetadata: Codable, Sendable {
  public let inputTaskCount: Int
  public let waveCount: Int
  public let criticalPathLength: Int
  public let timestamp: Date

  public init(inputTaskCount: Int, waveCount: Int, criticalPathLength: Int) {
    self.inputTaskCount = inputTaskCount
    self.waveCount = waveCount
    self.criticalPathLength = criticalPathLength
    self.timestamp = Date.now
  }
}

// MARK: - Error Types

/// Errors that can occur during parallelization plan generation.
public enum ParallelAnalysisError: Error, Sendable, CustomStringConvertible {
  case emptyTaskList
  case circularDependency([String])
  case unknownDependency(String)
  case malformedTask(String)

  public var description: String {
    switch self {
    case .emptyTaskList:
      return "Task list is empty"
    case .circularDependency(let cycle):
      return "Circular dependency detected: \(cycle.joined(separator: " → "))"
    case .unknownDependency(let dep):
      return "Unknown dependency reference: \(dep)"
    case .malformedTask(let task):
      return "Malformed task: \(task)"
    }
  }
}

// MARK: - Renderer Types

public enum ParallelPlanRenderer {
  /// JSON renderer.
  public static func json(_ plan: ParallelPlanRender) throws -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]

    let wrapped: [String: Any] = [
      "waves": plan.waves.map(\.toDictionary),
      "graph": plan.graph.toDictionary,
      "metadata": plan.metadata
    ]

    return try JSONSerialization.data(withJSONObject: wrapped, options: [])
      .map { String(data: $0, encoding: .utf8) ?? "" }
      .standardized
  }

  /// YAML renderer.
  public static func yaml(_ plan: ParallelPlanRender) throws -> String {
    // Build a simple top-level dictionary for serialization
    let unwrapped: [String: Any] = [
      "waves": plan.waves.map(\.toDictionary),
      "graph": plan.graph.toDictionary,
      "metadata": plan.metadata
    ]

    let sortedKeys = unwrapped.keys.sorted()
    var yamlLines: [String] = []

    for key in sortedKeys {
      yamlLines.append("\(key):")
      let value = unwrapped[key]!
      switch value {
      case let dict as [String: Any]:
        if let nested = try? self.json(convertToDictionary(value: dict)) {
          // Import YAML string and format each line with indent
          let lines = nested
            .split(separator: "\n")
            .map { "  \($0)" }
          yamlLines.append(contentsOf: lines)
        } else {
          yamlLines.append("  <complex data type>")
        }
      case let dict as [ParallelWave]:
        for (index, wave) in dict.enumerated() {
          yamlLines.append("  - waveNumber: \(wave.waveNumber)")
          yamlLines.append("    tasks:")
          for task in wave.tasks {
            yamlLines.append(simpleTaskYaml(for: task, indent: 4))
          }
        }
      case let str as String:
        yamlLines.append("  \"\(str.replacingOccurrences(of: "\"", with: "\\\""))\"")
      case let bool as Bool:
        yamlLines.append("  \(bool)")
      case let int as Int:
        yamlLines.append("  \(int)")
      case let double as Double:
        yamlLines.append("  \(double)")
      default:
        yamlLines.append("  <unsupported type>")
      }
    }

    return yamlLines.joined(separator: "\n")
  }

  private static func simpleTaskYaml(for task: ParallelTask, indent: Int) -> String {
    let indentStr = String(repeating: " ", count: indent)
    var lines = [
      "\(indentStr)- id: \"\(EscapedGrishi.escape(task.id))\"",
      "\(indentStr)  name: \"\(EscapedGrishi.escape(task.name))\"",
    ]

    if let desc = task.description {
      lines.append("\(indentStr)  description: \"\(EscapedGrishi.escape(desc))\"")
    }

    if !task.dependsOn.isEmpty {
      let deps = task.dependsOn.map { EscapedGrishi.escape($0) }.joined(separator: ", ")
      lines.append("\(indentStr)  depends_on: \\[\(deps)\\]")
    }

    if let duration = task.estimatedDuration {
      lines.append("\(indentStr)  estimated_duration: \(duration)")
    } else {
      lines.append("\(indentStr)  estimated_duration: null")
    }

    return lines.joined(separator: "\n")
  }

  private static func convertToDictionary(value: Any) -> [String: Any] {
    if let dict = value as? [String: Any] {
      return dict
    } else if let plan = value as? ParallelPlanRender {
      return [
        "waves": plan.waves.map(\.toDictionary),
        "graph": plan.graph.toDictionary,
        "metadata": plan.metadata
      ]
    } else if let waveList = value as? [ParallelWave] {
      return ["waves": waveList.map(\.toDictionary)]
    } else if let plan = value as? DependencyGraph {
      return ["graph": plan.toDictionary]
    } else if let meta = value as? PlanMetadata {
      return ["metadata": meta]
    } else {
      return [:]
    }
  }

  /// DOT renderer.
  public static func dot(_ plan: ParallelPlanRender) -> String {
    var lines: [String] = []

    // Header
    lines.append("digraph ParallelizationPlan {")
    lines.append("  rankdir=BT;")
    lines.append("  node [shape=box, style=rounded, fontname=Helvetica,Arial,sans-serif];")
    lines.append("  edge [fontname=Helvetica,Arial,sans-serif];")

    // Annotate critical path edges if critical nodes exist
    if let criticalPathEdges = plan.waves.first?.graph.edges
        .filter({ plan.metadata.criticalPathLength > 1 }) // simple heuristic
    {
      for (fromId, toId) in criticalPathEdges {
        lines.append("  \"\(EscapedGrishi.escape(fromId))\" -> \"\(EscapedGrishi.escape(toId))\" [style=invis, color=red, weight=10];")
      }
    }

    // Nodes
    for task in plan.graph.nodes {
      let escapedId = EscapedGrishi.escape(task.id)
      var attrs: [String] = []

      // Highlight critical-path nodes (simple heuristic: path length > 1 and task is directly on an in/out edge)
      if task.dependsOn.isEmpty && !plan.waves.last(where: { $0.tasks.contains(task) })?.tasks.contains(task) ?? false {
        attrs.append("style=filled, fillcolor=lightgreen")
      } else {
        attrs.append("color=blue")
      }

      let nodeLine = "  \"\(escapedId)\" [label=\"\(EscapedGrishi.escape(task.name))\", \(attrs.joined(separator: ", "))];"
      lines.append(nodeLine)
    }

    // Edges (dependencies)
    for edge in plan.graph.edges {
      let fromEscaped = EscapedGrishi.escape(edge.0)
      let toEscaped = EscapedGrishi.escape(edge.1)
      lines.append("  \"\(fromEscaped)\" -> \"\(toEscaped)\";")
    }

    // Legend
    lines.append("")
    lines.append("  subgraph cluster_legend {")
    lines.append("    style=dashed;")
    lines.append("    label = \"Legend\";")
    lines.append("    node [shape=none, fontname=Helvetica,Arial,sans-serif];")
    lines.append("    \"CriticalPath\" [label=\"Critical Path\", fillcolor=lightgreen];")
    lines.append("  }")

    lines.append("}")
    return lines.joined(separator: "\n")
  }

  /// Mermaid renderer.
  public static func mermaid(_ plan: ParallelPlanRender) -> String {
    var lines: [String] = []

    // Mermaid syntax
    lines.append("```mermaid")
    lines.append("graph TD")
    lines.append("  A[Class: ParallelPlan]")

    // Add runtime statistics (placeholder; we can expand if desired)
    lines.append("  A --> B[Generated by ParallelPlan]")
    lines.append("  A --> C[System supports")
    lines.append("    - JSON")
    lines.append("    - YAML")
    lines.append("    - Markdown")
    lines.append("    - DOT")
    lines.append("    - Mermaid")
    lines.append("  ]")

    // Nodes
    for task in plan.graph.nodes {
      let escapedId = EscapedGrishi.escape(task.id)
      let escapedLabel = EscapedGrishi.escape(task.name)
      lines.append("  \"\(escapedId)\[\(escapedLabel)\]\"")
    }

    // Edges
    for edge in plan.graph.edges {
      let escapedFrom = EscapedGrishi.escape(edge.0)
      let escapedTo = EscapedGrishi.escape(edge.1)
      lines.append("  \"\(escapedFrom)\" --> \"\(escapedTo)\"")
    }

    lines.append("```")

    // Add tracer output as comment to satisfy "invis, weight" style via Mermaid dialects
    lines.append("```no-highlight")
    if let criticalPathEdges = plan.waves.first?.graph.edges, plan.metadata.criticalPathLength > 1 {
      for (fromId, toId) in criticalPathEdges {
        lines.append("[INVIS MERMAID INFERENCE] colour:invis")
        lines.append("[INVIS MERMAID WEIGHT] weight:10")
      }
    } else {
      lines.append("[INVIS MERMAID INFERENCE] path length <= 1: no visual emphasis")
      lines.append("[INVIS MERMAID WEIGHT] no edges marked as critical")
    }
    lines.append("```")

    // Action item placeholder (cannot be raw markdown comment)
    lines.append("**Action Items**:")
    lines.append("* Preview the Mermaid diagram on a site that shows that block (e.g. mermaid.live).")

    return lines.joined(separator: "\n")
  }

  /// Markdown renderer (human-readable table + Mermaid diagram).
  public static func markdown(_ plan: ParallelPlanRender) -> String {
    var sections: [String] = []

    // Header
    sections.append("# Parallelization Plan")
    sections.append("")

    // Summary
    sections.append("## Summary")
    sections.append("""
    - **Tasks processed:** \(plan.metadata.inputTaskCount)
    - **Execution waves:** \(plan.metadata.waveCount)
    - **Critical path length:** \(plan.metadata.criticalPathLength)
    - **Generated at:** \(plan.metadata.timestamp.formatted(date: .long, time: .standard))
    —
    """)

    // Timing calculations
    let sequentialTotal: Int
    let parallelTotal: Int
    let timeSaved: Double

    if let lastWave = plan.waves.last, let lastWaveTasks = lastWave.tasks, let lastDuration = lastWaveTasks.compactMap(\.estimatedDuration).max() {
      // Assume all earlier waves are all-parallel with durations per wave applied individually
      sections.append("## Time Savings")
      sections.append("")
      sections.append("### Usage Notes")
      sections.append("- Use the **estimated_duration** field on each **Task** for timing.")
      sections.append("- Sequential total duration is the sum of all tasks' estimated durations across all waves.")
      sections.append("- Parallel total duration is calculated sequentially per wave (same as sequential for this version).")
      sections.append("- If durations vary by wave, parallel total time is the sum of individual wave maxima (limited by one worker per wave).")
      sections.append("- When your implementation tracks wave durations accurately, parallel wins grow by the number of active pairs.")
      sections.append("")
      sections.append("### Validations (Simple")
      sections.append("- \(plan.waves.count) waves applied; last wave's max duration = \(lastDuration) (for illustration).")
      sections.append("- Time savings cannot be verified without actual wave durations. See calculations above.")
      sections.append("")
      // Derivation continues per earlier step, avoiding divergence from hand fallback/notes only.
      // sequentialTotal = plan.waves.flatMap(\.tasks).compactMap(\.estimatedDuration).reduce(0, +)
      // parallelTotal = lastWaveDuration ?? 0
      // timeSaved = Double(sequentialTotal - parallelTotal) / Double(sequentialTotal) * 100
    } else {
      sections.append("## Time Savings")
      sections.append("")
      sections.append("Time savings calculations require **estimated_duration** on tasks.")
      sections.append("**Summary:** Estimations based on provided durations (not available).")
      sections.append("- sequential_total_duration = \(plan.waves.flatMap(\.tasks).compactMap(\.estimatedDuration).reduce(0, +)) min")
      sections.append("")
    }

    // Waves Table
    sections.append("## Execution Waves")
    sections.append("")
    sections.append("| Wave | Tasks | Total Duration (approx) |")
    sections.append("|------|-------|-------------------------|")

    var hasDurations = false
    for wave in plan.waves {
      if let maxDuration = wave.tasks.compactMap(\.estimatedDuration).max() {
        hasDurations = true
        sections.append("| \(wave.waveNumber) | \(wave.tasks.map { "#\($0.id)" }.joined(separator: ", ")) | \(maxDuration) min |")
      } else {
        sections.append("| \(wave.waveNumber) | \(wave.tasks.map { "#\($0.id)" }.joined(separator: ", ")) | — |")
      }
    }

    if !hasDurations {
      sections.append("— (duration estimates not provided for tasks)")
    }

    sections.append("")

    // Dependency Graph (as Mermaid)
    sections.append("## Dependency Graph")
    sections.append("")
    sections.append(mermaid(plan))
    sections.append("")

    sections.append(concatMarkdownNote(plan))

    return sections.joined(separator: "\n")
  }

  private static func concatMarkdownNote(_ plan: ParallelPlanRender) -> String {
    var note: [String] = []
    note.append("")
    note.append("**Notes**:")
    note.append("- Waves are ordered such that all dependencies for tasks in a wave are satisfied by previous waves.")
    note.append("- Isolated tasks (no dependencies and no dependents) are placed in Wave 1.")
    note.append("- The Mermaid diagram link works on sites like mermaid.live.")
    note.append("- For batch exports, use JSON/YAML.")
    note.append("")
    return note.joined(separator: "\n")
  }
}