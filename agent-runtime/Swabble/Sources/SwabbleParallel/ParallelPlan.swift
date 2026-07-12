import Foundation

// MARK: - Task Model

public struct Task: Identifiable, Codable, Hashable, Sendable {
    public let id: UUID
    public let name: String
    public let description: String
    public var dependsOn: [Task.ID]
    public var estimatedDurationMinutes: Int?

    public init(
        id: UUID = UUID(),
        name: String,
        description: String,
        dependsOn: [Task.ID] = [],
        estimatedDurationMinutes: Int? = nil
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.dependsOn = dependsOn
        self.estimatedDurationMinutes = estimatedDurationMinutes
    }
}

extension Task.ID {
    public static var from(_ id: UUID): Self { id }
}

// MARK: - Plan Models

public struct ParallelPlan: Codable, Sendable {
    public let tasks: [Task]
    public let waves: [TaskWave]
    public let criticalPath: [Task.ID]
    public let metadata: PlanMetadata
    public let dependencies: [DependencyEdge]
    public let dotGraph: String
    public let mermaidDiagram: String

    public struct TaskWave: Codable, Sendable {
        public let waveNumber: Int
        public let taskIds: [Task.ID]
        public let taskNames: [String]
        public let wallClockMinutes: Int

        public init(waveNumber: Int, tasks: [Task], wallClockMinutes: Int = 0) {
            self.waveNumber = waveNumber
            self.taskIds = tasks.map { $0.id }
            self.taskNames = tasks.map { $0.name }
            self.wallClockMinutes = wallClockMinutes >= 0 ? wallClockMinutes : 0
        }
    }

    public struct PlanMetadata: Codable, Sendable {
        public let inputTaskCount: Int
        public let waveCount: Int
        public let criticalPathLength: Int
        public let sequentialTimeMinutes: Int
        public let parallelTimeMinutes: Int
        public let timeSavedPercentage: Double
        public let timestamp: Date
        public let format: OutputFormat

        public init(
            inputTaskCount: Int,
            waveCount: Int,
            criticalPathLength: Int,
            sequentialTimeMinutes: Int,
            parallelTimeMinutes: Int,
            timeSavedPercentage: Double,
            timestamp: Date = Date(),
            format: OutputFormat
        ) {
            self.inputTaskCount = inputTaskCount
            self.waveCount = waveCount
            self.criticalPathLength = criticalPathLength
            self.sequentialTimeMinutes = sequentialTimeMinutes
            self.parallelTimeMinutes = parallelTimeMinutes
            self.timeSavedPercentage = timeSavedPercentage
            self.timestamp = timestamp
            self.format = format
        }
    }

    public struct DependencyEdge: Codable, Sendable {
        public let from: Task.ID
        public let to: Task.ID
        public let isCritical: Bool

        public init(from: Task.ID, to: Task.ID, isCritical: Bool = false) {
            self.from = from
            self.to = to
            self.isCritical = isCritical
        }
    }

    public enum OutputFormat: String, Codable, Sendable {
        case json
        case yaml
        case markdown
        case dot
        case mermaid
    }

    public init(tasks: [Task], waves: [TaskWave], criticalPath: [Task.ID], dependencies: [DependencyEdge], dotGraph: String, mermaidDiagram: String, metadata: PlanMetadata) {
        self.tasks = tasks
        self.waves = waves
        self.criticalPath = criticalPath
        self.dependencies = dependencies
        self.dotGraph = dotGraph
        self.mermaidDiagram = mermaidDiagram
        self.metadata = metadata
    }
}

// MARK: - Errors

public enum ParallelAnalysisError: Error, Codable, LocalizedError, Sendable {
    case emptyTaskList
    case circularDependency(chain: [Task.ID])
    case unknownDependency(taskId: Task.ID, ref: Task.ID)
    case duplicateTask(id: Task.ID)

    public var errorDescription: String? {
        switch self {
        case .emptyTaskList:
            return "Task list cannot be empty"
        case .circularDependency(let chain):
            let cycleString = chain.map { id -> String in
                if let task = tasks.first(where: { $0.id == id }) {
                    return task.name
                }
                return String(describing: id)
            }.joined(separator: " → ")
            return "Circular dependency detected: \(cycleString)"
        case .unknownDependency(let task, let ref):
            return "Unknown dependency: Task \(task) references non-existent task \(ref)"
        case .duplicateTask(let id):
            return "Duplicate task with ID \(id)"
        }
    }

    public var errorCode: String {
        switch self {
        case .emptyTaskList: return "EMPTY_LIST"
        case .circularDependency: return "CIRCULAR_DEPENDENCY"
        case .unknownDependency: return "UNKNOWN_DEPENDENCY"
        case .duplicateTask: return "DUPLICATE_TASK"
        }
    }
}