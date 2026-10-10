import Foundation

public enum CoderClawRemindersCommand: String, Codable, Sendable {
    case list = "reminders.list"
    case add = "reminders.add"
}

public enum CoderClawReminderStatusFilter: String, Codable, Sendable {
    case incomplete
    case completed
    case all
}

public struct CoderClawRemindersListParams: Codable, Sendable, Equatable {
    public var status: CoderClawReminderStatusFilter?
    public var limit: Int?

    public init(status: CoderClawReminderStatusFilter? = nil, limit: Int? = nil) {
        self.status = status
        self.limit = limit
    }
}

public struct CoderClawRemindersAddParams: Codable, Sendable, Equatable {
    public var title: String
    public var dueISO: String?
    public var notes: String?
    public var listId: String?
    public var listName: String?

    public init(
        title: String,
        dueISO: String? = nil,
        notes: String? = nil,
        listId: String? = nil,
        listName: String? = nil)
    {
        self.title = title
        self.dueISO = dueISO
        self.notes = notes
        self.listId = listId
        self.listName = listName
    }
}

public struct CoderClawReminderPayload: Codable, Sendable, Equatable {
    public var identifier: String
    public var title: String
    public var dueISO: String?
    public var completed: Bool
    public var listName: String?

    public init(
        identifier: String,
        title: String,
        dueISO: String? = nil,
        completed: Bool,
        listName: String? = nil)
    {
        self.identifier = identifier
        self.title = title
        self.dueISO = dueISO
        self.completed = completed
        self.listName = listName
    }
}

public struct CoderClawRemindersListPayload: Codable, Sendable, Equatable {
    public var reminders: [CoderClawReminderPayload]

    public init(reminders: [CoderClawReminderPayload]) {
        self.reminders = reminders
    }
}

public struct CoderClawRemindersAddPayload: Codable, Sendable, Equatable {
    public var reminder: CoderClawReminderPayload

    public init(reminder: CoderClawReminderPayload) {
        self.reminder = reminder
    }
}
