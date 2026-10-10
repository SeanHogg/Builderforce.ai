import Foundation

/// One of the workspace's Brain chats — the same conversations the web app, the VS Code
/// extension and Synapse show.
public struct BrainChat: Codable, Sendable, Equatable, Identifiable, Hashable {
    public let id: Int
    public let title: String?
    public let createdAt: String?
    public let updatedAt: String?

    public init(id: Int, title: String?, createdAt: String? = nil, updatedAt: String? = nil) {
        self.id = id
        self.title = title
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}

/// One stored turn. `metadata` is a JSON document kept as text (who it is addressed to,
/// who wrote it, its attachments).
public struct BrainChatMessage: Codable, Sendable, Equatable, Identifiable, Hashable {
    public let id: Int
    public let role: String
    public let content: String
    public let metadata: String?
    public let seq: Int?
    public let createdAt: String?

    public init(id: Int, role: String, content: String, metadata: String? = nil, seq: Int? = nil, createdAt: String? = nil) {
        self.id = id
        self.role = role
        self.content = content
        self.metadata = metadata
        self.seq = seq
        self.createdAt = createdAt
    }

    /// Another participant's reply names its author (`metadata.authoredBy.name`).
    public var authorName: String? {
        guard let object = self.metadataObject,
              let author = object["authoredBy"] as? [String: Any],
              let name = author["name"] as? String,
              !name.isEmpty
        else { return nil }
        return name
    }

    /// The agent a person's turn was addressed to (`metadata.addressedTo.ref`).
    public var addressedAgentRef: String? {
        guard let object = self.metadataObject,
              let addressed = object["addressedTo"] as? [String: Any],
              (addressed["kind"] as? String) != "human"
        else { return nil }
        if let ref = addressed["ref"] as? String { return ref }
        if let ref = addressed["ref"] as? Int { return String(ref) }
        return nil
    }

    private var metadataObject: [String: Any]? {
        guard let metadata, let data = metadata.data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }
}

/// An agent assigned to a chat — someone a person can address with "To …".
public struct BrainChatAgent: Codable, Sendable, Equatable, Identifiable, Hashable {
    /// The assignment's id.
    public let id: String
    public let agentRef: String
    public let agentKind: String?
    public let name: String
    public let role: String?

    enum CodingKeys: String, CodingKey {
        case id
        case agentRef
        case agentKind
        case name
        case role
    }

    public init(id: String, agentRef: String, agentKind: String? = nil, name: String, role: String? = nil) {
        self.id = id
        self.agentRef = agentRef
        self.agentKind = agentKind
        self.name = name
        self.role = role
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try Self.flexibleString(container, .id)
        self.agentRef = try Self.flexibleString(container, .agentRef)
        self.agentKind = try container.decodeIfPresent(String.self, forKey: .agentKind)
        let name = try container.decodeIfPresent(String.self, forKey: .name)
        self.name = (name?.isEmpty ?? true) ? self.agentRef : (name ?? self.agentRef)
        self.role = try container.decodeIfPresent(String.self, forKey: .role)
    }

    /// Ids arrive as strings or numbers depending on where the agent was registered.
    private static func flexibleString(_ container: KeyedDecodingContainer<CodingKeys>, _ key: CodingKeys) throws -> String {
        if let text = try? container.decode(String.self, forKey: key) { return text }
        return try String(container.decode(Int.self, forKey: key))
    }
}

/// A file uploaded for a message (`POST /api/brain/upload`).
public struct BrainChatAttachment: Codable, Sendable, Equatable, Hashable {
    public let key: String
    public let name: String
    public let type: String

    public init(key: String, name: String, type: String) {
        self.key = key
        self.name = name
        self.type = type
    }
}

/// The typed `/api/brain/chats` client. Request building and decoding are static and pure
/// (tested without a network); the instance methods run them through the session.
public struct BrainChatAPI: Sendable {
    public static let listLimit = 50
    public static let messageLimit = 100

    private let session: CloudSession

    public init(session: CloudSession) {
        self.session = session
    }

    public func listChats() async throws -> [BrainChat] {
        try await Self.decodeChats(self.session.perform(Self.listChatsRequest()))
    }

    public func createChat(title: String?) async throws -> BrainChat {
        try await CloudJSON.decode(BrainChat.self, from: self.session.perform(Self.createChatRequest(title: title)))
    }

    public func messages(chatID: Int, limit: Int = BrainChatAPI.messageLimit) async throws -> [BrainChatMessage] {
        try await Self.decodeMessages(self.session.perform(Self.messagesRequest(chatID: chatID, limit: limit)))
    }

    public func agents(chatID: Int) async throws -> [BrainChatAgent] {
        try await Self.decodeAgents(self.session.perform(Self.agentsRequest(chatID: chatID)))
    }

    /// Post the person's message, addressed to `agent` (the platform dispatches its
    /// reply) or to the Brain (`agent == nil`).
    public func send(
        chatID: Int,
        content: String,
        to agent: BrainChatAgent? = nil,
        attachments: [BrainChatAttachment] = []) async throws
    {
        let request = try Self.sendRequest(chatID: chatID, content: content, to: agent, attachments: attachments)
        _ = try await self.session.perform(request)
    }

    /// Persist the Brain's finished answer.
    public func appendAssistant(chatID: Int, content: String) async throws {
        _ = try await self.session.perform(Self.appendAssistantRequest(chatID: chatID, content: content))
    }

    public func upload(fileName: String, mimeType: String, data: Data) async throws -> BrainChatAttachment {
        try await CloudJSON.decode(
            BrainChatAttachment.self,
            from: self.session.upload(fileName: fileName, mimeType: mimeType, data: data))
    }

    /// Where an uploaded file is read back (the link a message carries).
    public func uploadURL(key: String) -> String {
        Self.uploadURL(base: self.session.config.gatewayBase, key: key)
    }

    // MARK: - Requests

    public static func listChatsRequest(limit: Int = BrainChatAPI.listLimit) -> CloudAPIRequest {
        CloudAPIRequest(method: "GET", path: "/api/brain/chats?limit=\(limit)")
    }

    public static func createChatRequest(title: String?) throws -> CloudAPIRequest {
        struct Body: Encodable { let title: String? }
        let trimmed = title?.trimmingCharacters(in: .whitespacesAndNewlines)
        let body = try CloudJSON.encode(Body(title: (trimmed?.isEmpty ?? true) ? nil : trimmed))
        return CloudAPIRequest(method: "POST", path: "/api/brain/chats", body: body)
    }

    public static func messagesRequest(chatID: Int, limit: Int = BrainChatAPI.messageLimit) -> CloudAPIRequest {
        CloudAPIRequest(method: "GET", path: "/api/brain/chats/\(chatID)/messages?limit=\(limit)")
    }

    public static func agentsRequest(chatID: Int) -> CloudAPIRequest {
        CloudAPIRequest(method: "GET", path: "/api/brain/chats/\(chatID)/agents")
    }

    public static func sendRequest(
        chatID: Int,
        content: String,
        to agent: BrainChatAgent?,
        attachments: [BrainChatAttachment]) throws -> CloudAPIRequest
    {
        let metadata = try Self.metadata(to: agent, attachments: attachments)
        return try Self.appendRequest(chatID: chatID, turn: Turn(role: "user", content: content, metadata: metadata))
    }

    public static func appendAssistantRequest(chatID: Int, content: String) throws -> CloudAPIRequest {
        try Self.appendRequest(chatID: chatID, turn: Turn(role: "assistant", content: content, metadata: nil))
    }

    public static func uploadURL(base: String, key: String) -> String {
        "\(base)/api/brain/uploads/\(key)"
    }

    /// The metadata text a person's turn carries: the agent it is addressed to (the
    /// platform dispatches that agent) and its attachments. `nil` when there is neither.
    static func metadata(to agent: BrainChatAgent?, attachments: [BrainChatAttachment]) throws -> String? {
        struct Addressee: Encodable {
            let kind = "agent"
            let ref: String
            let name: String
        }
        struct Metadata: Encodable {
            let addressedTo: Addressee?
            let attachments: [BrainChatAttachment]?
        }
        guard agent != nil || !attachments.isEmpty else { return nil }
        let value = Metadata(
            addressedTo: agent.map { Addressee(ref: $0.agentRef, name: $0.name) },
            attachments: attachments.isEmpty ? nil : attachments)
        return try String(decoding: CloudJSON.encode(value), as: UTF8.self)
    }

    private struct Turn: Encodable {
        let role: String
        let content: String
        let metadata: String?
    }

    private static func appendRequest(chatID: Int, turn: Turn) throws -> CloudAPIRequest {
        struct Body: Encodable { let messages: [Turn] }
        return try CloudAPIRequest(
            method: "POST",
            path: "/api/brain/chats/\(chatID)/messages",
            body: CloudJSON.encode(Body(messages: [turn])))
    }

    // MARK: - Decoding

    public static func decodeChats(_ data: Data) throws -> [BrainChat] {
        struct Listing: Decodable { let chats: [BrainChat]? }
        return try CloudJSON.decode(Listing.self, from: data).chats ?? []
    }

    /// The transcript, oldest first.
    public static func decodeMessages(_ data: Data) throws -> [BrainChatMessage] {
        struct Listing: Decodable { let messages: [BrainChatMessage]? }
        let messages = try CloudJSON.decode(Listing.self, from: data).messages ?? []
        guard messages.allSatisfy({ $0.seq != nil }) else { return messages }
        return messages.sorted { ($0.seq ?? 0) < ($1.seq ?? 0) }
    }

    public static func decodeAgents(_ data: Data) throws -> [BrainChatAgent] {
        struct Listing: Decodable { let agents: [BrainChatAgent]? }
        return try CloudJSON.decode(Listing.self, from: data).agents ?? []
    }
}
