import BuilderforceKit
import Foundation

/// An image or file the person attached, ready to upload.
public struct BuilderforceChatUpload: Sendable, Equatable {
    public let fileName: String
    public let mimeType: String
    public let data: Data

    public init(fileName: String, mimeType: String, data: Data) {
        self.fileName = fileName
        self.mimeType = mimeType
        self.data = data
    }
}

/// What the chat view model needs from Builderforce: the signed-in state and its
/// device-code sign-in, the workspace's Brain chats, their messages and assigned agents,
/// and the Brain's reply. The live implementation is `BuilderforceCloudChatTransport`;
/// tests substitute their own.
public protocol BuilderforceChatTransport: Sendable {
    func isSignedIn() async -> Bool
    func startSignIn() async throws -> DeviceCode
    /// Wait for the person to approve `code`. Cancel the Task to stop waiting.
    func finishSignIn(_ code: DeviceCode) async throws
    func signOut() async

    func listChats() async throws -> [BrainChat]
    func createChat(title: String?) async throws -> BrainChat
    func messages(chatID: Int) async throws -> [BrainChatMessage]
    func agents(chatID: Int) async throws -> [BrainChatAgent]

    /// Upload one attachment; the stored file and the URL a message links to it with.
    func upload(_ upload: BuilderforceChatUpload) async throws -> (attachment: BrainChatAttachment, url: String)

    /// Post the person's turn — to `agent` (the platform dispatches its reply) or to the
    /// Brain (`agent == nil`, answered by `reply`).
    func send(chatID: Int, content: String, to agent: BrainChatAgent?, attachments: [BrainChatAttachment]) async throws

    /// Run the Brain's reply to the latest turn and persist it. Cancel the Task to stop.
    func reply(
        chatID: Int,
        imageURLs: [String],
        approve: @escaping @Sendable (BrainToolApproval) async -> Bool,
        onEvent: @escaping @Sendable (BrainReplyEvent) async -> Void) async throws
}

/// The live transport: the Builderforce cloud, through the app's shared `CloudAccount`.
public struct BuilderforceCloudChatTransport: BuilderforceChatTransport {
    private let account: CloudAccount

    public init(account: CloudAccount = .shared) {
        self.account = account
    }

    public func isSignedIn() async -> Bool {
        await self.account.isSignedIn
    }

    public func startSignIn() async throws -> DeviceCode {
        try await self.account.startSignIn()
    }

    public func finishSignIn(_ code: DeviceCode) async throws {
        try await self.account.finishSignIn(code)
    }

    public func signOut() async {
        await self.account.signOut()
    }

    public func listChats() async throws -> [BrainChat] {
        try await self.account.withSession { try await BrainChatAPI(session: $0).listChats() }
    }

    public func createChat(title: String?) async throws -> BrainChat {
        try await self.account.withSession { try await BrainChatAPI(session: $0).createChat(title: title) }
    }

    public func messages(chatID: Int) async throws -> [BrainChatMessage] {
        try await self.account.withSession { try await BrainChatAPI(session: $0).messages(chatID: chatID) }
    }

    public func agents(chatID: Int) async throws -> [BrainChatAgent] {
        try await self.account.withSession { try await BrainChatAPI(session: $0).agents(chatID: chatID) }
    }

    public func upload(_ upload: BuilderforceChatUpload) async throws -> (attachment: BrainChatAttachment, url: String) {
        let stored = try await self.account.withSession { session -> UploadedFile in
            let api = BrainChatAPI(session: session)
            let attachment = try await api.upload(fileName: upload.fileName, mimeType: upload.mimeType, data: upload.data)
            return UploadedFile(attachment: attachment, url: api.uploadURL(key: attachment.key))
        }
        return (stored.attachment, stored.url)
    }

    public func send(
        chatID: Int,
        content: String,
        to agent: BrainChatAgent?,
        attachments: [BrainChatAttachment]) async throws
    {
        try await self.account.withSession {
            try await BrainChatAPI(session: $0).send(chatID: chatID, content: content, to: agent, attachments: attachments)
        }
    }

    public func reply(
        chatID: Int,
        imageURLs: [String],
        approve: @escaping @Sendable (BrainToolApproval) async -> Bool,
        onEvent: @escaping @Sendable (BrainReplyEvent) async -> Void) async throws
    {
        try await self.account.withSession {
            try await BrainReplyRunner(session: $0).run(
                chatID: chatID,
                imageURLs: imageURLs,
                approve: approve,
                onEvent: onEvent)
        }
    }

    private struct UploadedFile: Sendable {
        let attachment: BrainChatAttachment
        let url: String
    }
}
