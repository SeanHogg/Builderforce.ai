import Foundation

public actor ParallelPlanAnalyzer {
    public init() {}

    /// Analyzes task dependencies and produces a parallelization plan.
    /// - Parameters:
    ///   - tasks: List of tasks with optional dependencies
    ///   - assumeIsolatedTasksFinishInWave1: If true, isolated tasks (no deps, no dependents) go in Wave 1. If false, they are placed in a separate "wave 0" preceding other waves that have deps.
    /// - Returns: `ParallelPlan` with waves, critical path, and graphs.
    /// - Throws: `ParallelAnalysisError.circularDependency` if a cycle is detected.
    public func analyze(
        tasks: [PlanTask],
        assumeIsolatedTasksFinishInWave1: Bool = true
    ) throws -> ParallelPlan {
        guard !tasks.isEmpty else {
            throw ParallelAnalysisError.emptyTaskList
        }

        // Validate that all dependencies exist, report first conflict
        for task in tasks {
            for depId in task.dependsOn {
                if !tasks.contains(where: { $0.id == depId }) {
                    throw ParallelAnalysisError.unknownDependency(taskId: task.id, ref: depId)
                }
            }
        }

        // Detect cycles using DFS
        let taskIds = Set(tasks.map { $0.id })
        var visited = Set<PlanTask.ID>()
        var recStack = Set<PlanTask.ID>()

        enum CycleDetection {
            case found(chain: [PlanTask.ID])
            case none
        }

        var cycleResult: CycleDetection = .none

        func findCycle(from taskId: PlanTask.ID, currentPath: [PlanTask.ID]) -> CycleDetection {
            visited.insert(taskId)
            recStack.insert(taskId)
            currentPath.append(taskId)

            if let task = tasks.first(where: { $0.id == taskId }) {
                for depId in task.dependsOn {
                    if !taskIds.contains(depId) { continue }

                    if !visited.contains(depId) {
                        let result = findCycle(from: depId, currentPath: currentPath)
                        if case .found(let chain) = result {
                            return result
                        }
                    } else if recStack.contains(depId) {
                        // Found a cycle - reconstruct it
                        let cycleStartIndex = currentPath.firstIndex(of: depId) ?? currentPath.count
                        let cycle = Array(currentPath[cycleStartIndex...]) + [depId]
                        return .found(chain: cycle)
                    }
                }
            }

            recStack.remove(taskId)
            currentPath.removeLast()
            return .none
        }

        for taskId in taskIds {
            if !visited.contains(taskId) {
                let result = findCycle(from: taskId, currentPath: [])
                if case .found(let chain) = result {
                    cycleResult = result
                    break
                }
            }
        }

        if case .found(let chain) = cycleResult {
            throw ParallelAnalysisError.circularDependency(chain: chain)
        }

        // Build adjacency list and compute step counts (number of dependencies)
        var adj: [PlanTask.ID: [PlanTask.ID]] = [:]
        var stepCount: [PlanTask.ID: Int] = [:]

        for task in tasks {
            adj[task.id] = task.dependsOn
            stepCount[task.id] = task.dependsOn.count
        }

        // Compute topological sort using Kahn's algorithm (DFS-based stable order)
        var remaining = taskIds
        var ordered = [PlanTask.ID]()

        while !remaining.isEmpty {
            // Find a node with no incoming edges
            var nextTaskId: PlanTask.ID? = nil
            for taskId in remaining {
                if stepCount[taskId] == 0 {
                    nextTaskId = taskId
                    break
                }
            }

            guard let taskId = nextTaskId else {
                // No node with zero incoming edges means there's a cycle (should have been caught)
                fatalError("Topological sort failed: residual graph contains cycle")
            }

            ordered.append(taskId)
            remaining.remove(taskId)

            // Decrement step count for neighbors
            if let neighbors = adj[taskId] {
                for neighborId in neighbors {
                    if stepCount[neighborId] != nil {
                        stepCount[neighborId, default: 0] -= 1
                    }
                }
            }
        }

        // Group into waves: all tasks with stepCount 0 after consuming prior waves
        var waves: [ParallelPlan.TaskWave] = []

        while !ordered.isEmpty {
            var waveTasks: [PlanTask] = []
            var waveStepCount = remainingIds(in: ordered)

            for taskId in ordered {
                if waveStepCount[taskId] == 0 {
                    if let task = tasks.first(where: { $0.id == taskId }) {
                        waveTasks.append(task)
                    }
                }
            }

            if !waveTasks.isEmpty {
                let maxDuration = waveTasks.compactMap { $0.estimatedDurationMinutes }.max() ?? 0
                waves.append(ParallelPlan.TaskWave(
                    waveNumber: waves.count + 1,
                    tasks: waveTasks,
                    wallClockMinutes: maxDuration
                ))
            }

            ordered.removeAll { !waveTasks.map(\.id).contains($0.id) }
        }

        // Identify critical path using DFS with longest path tracking
        func getCriticalPath(
            _ taskId: PlanTask.ID,
            _ seen: Set<PlanTask.ID>,
            _ path: [PlanTask.ID],
            _ endTime: [PlanTask.ID: Int]
        ) -> ([PlanTask.ID], Int) {
            var currentPath = path
            currentPath.append(taskId)

            guard let task = tasks.first(where: { $0.id == taskId }) else {
                return ([taskId], endTime[taskId, default: 0])
            }

            guard task.dependsOn.isEmpty else {
                var maxLength = 0
                var maxLengthPath: [PlanTask.ID] = currentPath

                for depId in task.dependsOn {
                    if let (depPath, depEnd) = getCriticalPath(depId, seen, currentPath, endTime) {
                        let total = depEnd
                        if total > maxLength || maxLength == 0 {
                            maxLength = total
                            maxLengthPath = depPath
                        }
                    }
                }

                endTime[taskId] = maxLength
                return (maxLengthPath, maxLength)
            }

            let duration = task.estimatedDurationMinutes ?? 0
            endTime[taskId] = duration
            return (currentPath, duration)
        }

        var globalEndTime: [PlanTask.ID: Int] = [:]
        let maxDurationPath = getCriticalPath(ordered.last ?? ordered.first!, [], [], globalEndTime)

        let criticalPath = maxDurationPath.0

        // Build dependency edges with critical-path markings
        var edges: [ParallelPlan.DependencyEdge] = []

        func buildEdges(_ parent: PlanTask.ID, _ path: Set<PlanTask.ID>) {
            guard let task = tasks.first(where: { $0.id == parent }) else { return }
            for depId in task.dependsOn {
                edges.append(ParallelPlan.DependencyEdge(
                    from: depId,
                    to: parent,
                    isCritical: path.contains(depId)
                ))
                guard path.contains(depId) else { continue }
                buildEdges(depId, path)
            }
        }

        for depId in criticalPath.dropFirst() {
            buildEdges(depId, Set(criticalPath))
        }

        // Compute metrics
        let sequentialTotal = tasks.compactMap { $0.estimatedDurationMinutes }.reduce(0, +)
        let parallelTotal = waves.reduce(0) { $0 + $1.wallClockMinutes }
        let timeSavedPercentage = sequentialTotal > 0 ? (Double(sequentialTotal - parallelTotal) / Double(sequentialTotal) * 100) : 0.0

        let metadata = ParallelPlan.PlanMetadata(
            inputTaskCount: tasks.count,
            waveCount: waves.count,
            criticalPathLength: criticalPath.count,
            sequentialTimeMinutes: sequentialTotal,
            parallelTimeMinutes: parallelTotal,
            timeSavedPercentage: timeSavedPercentage.truncatingRemainder(dividingBy: 1) >= 0.005 ? timeSavedPercentage : round(timeSavedPercentage),
            format: .json
        )

        return ParallelPlan(
            tasks: tasks,
            waves: waves,
            criticalPath: criticalPath,
            dependencies: edges,
            dotGraph: renderDOTGraph(tasks: tasks, dependencies: edges, criticalPath: criticalPath),
            mermaidDiagram: renderMermaidDiagram(tasks: tasks, dependencies: edges, criticalPath: criticalPath),
            metadata: metadata
        )
    }

    private func remainingIds(in ordered: [PlanTask.ID]) -> [PlanTask.ID: Int] {
        var remaining = [PlanTask.ID: Int]()
        for task in tasks {
            remaining[task.id] = task.dependsOn.count
        }
        return remaining
    }

    private func renderDOTGraph(
        tasks: [PlanTask],
        dependencies: [ParallelPlan.DependencyEdge],
        criticalPath: [PlanTask.ID]
    ) -> String {
        var lines: [String] = ["directed graph Plan {"]
        lines.append("  node [fontname=Helvetica, fontsize=10, shape=box, style=filled, fillcolor=white];")
        lines.append("  edge [fontname=Helvetica, fontsize=9, color=gray50, penwidth=1.0];")

        // Enforce topological order by drawing nodes in wave order
        let waveOrder = Dictionary(grouping: tasks) { task -> Int? in
            let waveIndex = tasks.firstIndex { $0.id == task.id }
            let wave = waves.first { taskIds(in: $0.taskIds).contains(task.id) }
            return taskIds(in: wave?.taskIds ?? []).firstIndex(of: task.id)
        }.compactMap { $0.value.sorted() ?? [], for: $0.key }

        // Assign IDs for topological ordering
        let taskIdToIdx: [PlanTask.ID: Int] = Dictionary(uniqueKeysWithValues: zip(tasks, Array(0..<tasks.count)))

        for i in 0..<tasks.count {
            let task = tasks[i]
            let pos = "pos=\"\(i),!\(i)\""

            if criticalPath.contains(task.id) {
                lines.append("  \"\(task.id.uuidString)\" [label=\"\\(EscapedGrishi.escape(task.name)): \(task.estimatedDurationMinutes ?? 0)m\", style=filled, fillcolor=\"#fff4e5\", shape=box];")
            } else {
                lines.append("  \"\(task.id.uuidString)\" [label=\"\\(EscapedGrishi.escape(task.name)): \(task.estimatedDurationMinutes ?? 0)m\"];")
            }

            lines.append("  \"\(task.id.uuidString)\" [\(pos)];")
        }

        for edge in dependencies {
            let attr = edge.isCritical ? "color=red, penwidth=2.0" : "color=gray60, style=dashed"
            lines.append("  \"\(edge.from.uuidString)\" -> \"\(edge.to.uuidString)\" [\(attr)];")
        }

        lines.append("}")
        return lines.joined(separator: "\n")
    }

    private func renderMermaidDiagram(
        tasks: [PlanTask],
        dependencies: [ParallelPlan.DependencyEdge],
        criticalPath: [PlanTask.ID]
    ) -> String {
        var lines: [String] = ["graph TD"]

        for edge in dependencies {
            let attr = edge.isCritical ? "stroke-width: 2px" : "stroke-width: 1px; stroke-dasharray:"
            lines.append("  \"\(edge.to.uuidString)[label=\\(EscapedGrishi.escape(edge.to.uuidString))<br/>\\(edge.from.uuidString)]\"[label=\\(EscapedGrishi.escape(edge.to.uuidString))<br/>\\(edge.from.uuidString)] -- \"\\(edge.from.uuidString)\" --> \"\(edge.to.uuidString)\"[\(attr)];")
        }

        return lines.joined(separator: "\n  ")
    }
}