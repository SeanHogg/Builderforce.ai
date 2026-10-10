import BuilderforceKit
import Foundation
import Observation
import OSLog
import UniformTypeIdentifiers

#if canImport(AppKit)
import AppKit
#elseif canImport(UIKit)
import UIKit
#endif

private let chatUILogger = Logger(subsystem: "ai.builderforce", category: "BuilderforceChatUI")

/// The chat on the Builderforce cloud Brain: the signed-in state, the workspace's chats and
/// the open one, its transcript, the Brain's reply as it streams, the agents assigned to
/// the chat, and follow-ups typed while a reply is running (sent once it finishes).
@MainActor
@Observable
public final class BuilderforceChatViewModel {
    public enum AuthState: Equatable {
        case unknown
        case signedOut
        /// A device-code sign-in in progress (`nil` code: asking the platform for one).
        case signingIn(DeviceCode?)
        case signedIn
    }

    /// How long an agent's reply is waited for, and how often the transcript is re-read.
    static let agentReplyWait: TimeInterval = 180
    static let agentReplyPoll: UInt64 = 3_000_000_000
    /// How long a tool waits for the person's approval before it is declined.
    static let approvalWait: UInt64 = 300_000_000_000

    public private(set) var authState: AuthState = .unknown
    public private(set) var chats: [BrainChat] = []
    public private(set) var activeChatID: Int?
    public private(set) var messages: [BuilderforceChatMessage] = []
    public private(set) var agents: [BrainChatAgent] = []
    /// The agent the next message goes to; `nil` = the Brain.
    public var recipient: BrainChatAgent?
    public private(set) var streamingAssistantText: String?
    public private(set) var activity: String?
    public private(set) var isLoading = false
    public private(set) var isSending = false
    /// A reply (the Brain's or an addressed agent's) is on its way.
    public private(set) var isRunning = false
    public private(set) var queued: [String] = []
    public private(set) var pendingApproval: BrainToolApproval?
    public var input: String = ""
    public var attachments: [BuilderforcePendingAttachment] = []
    public var errorText: String?

    private let transport: any BuilderforceChatTransport
    @ObservationIgnored private var runTask: Task<Void, Never>?
    @ObservationIgnored private var signInTask: Task<Void, Never>?
    @ObservationIgnored private var approvalContinuation: CheckedContinuation<Bool, Never>?
    @ObservationIgnored private var approvalTimeout: Task<Void, Never>?
    @ObservationIgnored private var didLoad = false
    /// The reply in flight; a stopped reply's late progress is ignored.
    @ObservationIgnored private var runToken: UUID?

    public init(transport: any BuilderforceChatTransport) {
        self.transport = transport
    }

    // MARK: - Derived state

    public var signedIn: Bool {
        self.authState == .signedIn
    }

    public var activeChat: BrainChat? {
        self.chats.first { $0.id == self.activeChatID }
    }

    public var isEmptyChat: Bool {
        self.messages.isEmpty && self.streamingAssistantText == nil && !self.isRunning
    }

    public var canSend: Bool {
        let hasText = !self.input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return self.signedIn && !self.isSending && (hasText || !self.attachments.isEmpty)
    }

    /// The Brain's tool in use, in the shape the transcript's tool bubble renders.
    public var pendingToolCalls: [BuilderforceChatPendingToolCall] {
        guard let activity else { return [] }
        return [BuilderforceChatPendingToolCall(
            toolCallId: "brain-activity",
            name: activity,
            args: nil,
            startedAt: nil,
            isError: nil)]
    }

    // MARK: - Lifecycle

    /// Load once (a view appearing again does not reload).
    public func load() {
        guard !self.didLoad else { return }
        self.didLoad = true
        Task { await self.bootstrap() }
    }

    public func refresh() {
        Task { await self.bootstrap() }
    }

    private func bootstrap() async {
        guard await self.transport.isSignedIn() else {
            if case .signingIn = self.authState { return }
            self.authState = .signedOut
            return
        }
        self.authState = .signedIn
        self.isLoading = true
        defer { self.isLoading = false }
        do {
            self.chats = try await self.transport.listChats()
            let keep = self.activeChatID.flatMap { id in self.chats.contains { $0.id == id } ? id : nil }
            if let chatID = keep ?? self.chats.first?.id {
                await self.open(chatID: chatID)
            }
            self.errorText = nil
        } catch {
            self.fail(error)
        }
    }

    // MARK: - Sign in

    public func startSignIn() {
        self.signInTask?.cancel()
        self.authState = .signingIn(nil)
        self.errorText = nil
        self.signInTask = Task { [weak self] in
            await self?.performSignIn()
        }
    }

    public func cancelSignIn() {
        self.signInTask?.cancel()
        self.signInTask = nil
        self.authState = .signedOut
    }

    public func signOut() {
        self.stop()
        Task {
            await self.transport.signOut()
            self.resetChats()
            self.authState = .signedOut
        }
    }

    private func performSignIn() async {
        do {
            let code = try await self.transport.startSignIn()
            self.authState = .signingIn(code)
            try await self.transport.finishSignIn(code)
            self.authState = .signedIn
            self.didLoad = true
            await self.bootstrap()
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            self.authState = .signedOut
            self.errorText = ChatStrings.describe(error)
        }
    }

    // MARK: - Chats

    public func selectChat(_ chatID: Int) {
        guard chatID != self.activeChatID else { return }
        self.stop()
        Task { await self.open(chatID: chatID) }
    }

    public func newChat() {
        self.stop()
        Task {
            do {
                let chat = try await self.transport.createChat(title: nil)
                self.chats.insert(chat, at: 0)
                await self.open(chatID: chat.id)
            } catch {
                self.fail(error)
            }
        }
    }

    private func open(chatID: Int) async {
        self.activeChatID = chatID
        self.messages = []
        self.agents = []
        self.recipient = nil
        self.streamingAssistantText = nil
        self.isLoading = true
        defer { self.isLoading = false }
        do {
            try await self.reloadMessages()
            let agents = try await self.transport.agents(chatID: chatID)
            guard self.activeChatID == chatID else { return }
            self.agents = agents
        } catch {
            self.fail(error)
        }
    }

    private func reloadMessages() async throws {
        guard let chatID = self.activeChatID else { return }
        let stored = try await self.transport.messages(chatID: chatID)
        guard self.activeChatID == chatID else { return }
        self.messages = Self.transcript(stored)
    }

    private func resetChats() {
        self.chats = []
        self.activeChatID = nil
        self.messages = []
        self.agents = []
        self.recipient = nil
        self.queued = []
    }

    // MARK: - Sending

    /// Send what is in the box. While a reply is running, the text waits and is sent
    /// once that reply finishes.
    public func send() {
        guard self.canSend else { return }
        let text = self.input.trimmingCharacters(in: .whitespacesAndNewlines)
        if self.isRunning {
            // Attachments stay in the box; the text goes once the reply finishes.
            guard !text.isEmpty else { return }
            self.queued.append(text)
            self.input = ""
            return
        }
        self.input = ""
        Task { await self.performSend(text: text, takeAttachments: true) }
    }

    /// Send a starter suggestion as the first message.
    public func sendSuggestion(_ text: String) {
        self.input = text
        self.send()
    }

    /// Stop the running reply (what it wrote so far is kept), and drop queued follow-ups.
    public func stop() {
        self.runTask?.cancel()
        self.runTask = nil
        self.runToken = nil
        self.queued = []
        self.resolveApproval(false)
        self.isRunning = false
        self.streamingAssistantText = nil
        self.activity = nil
    }

    public func removeQueued(at index: Int) {
        guard self.queued.indices.contains(index) else { return }
        self.queued.remove(at: index)
    }

    public func decideApproval(_ approve: Bool) {
        self.resolveApproval(approve)
    }

    private func performSend(text: String, takeAttachments: Bool) async {
        let attachments = takeAttachments ? self.attachments : []
        if takeAttachments {
            self.attachments = []
        }
        self.isSending = true
        self.errorText = nil
        defer { self.isSending = false }
        var optimisticID: UUID?
        do {
            let chatID = try await self.ensureChat()
            var content = text
            var stored: [BrainChatAttachment] = []
            var imageURLs: [String] = []
            for attachment in attachments {
                let uploaded = try await self.transport.upload(BuilderforceChatUpload(
                    fileName: attachment.fileName,
                    mimeType: attachment.mimeType,
                    data: attachment.data))
                stored.append(uploaded.attachment)
                content += "\n\n[Attached: \(uploaded.attachment.name)](\(uploaded.url))"
                if let dataURL = Self.visionDataURL(attachment) {
                    imageURLs.append(dataURL)
                }
            }
            let to = self.recipient
            let optimistic = Self.optimisticTurn(content.trimmingCharacters(in: .whitespacesAndNewlines))
            optimisticID = optimistic.id
            self.messages.append(optimistic)
            try await self.transport.send(chatID: chatID, content: optimistic.plainText, to: to, attachments: stored)
            self.beginReply(chatID: chatID, to: to, imageURLs: imageURLs)
        } catch {
            // The turn was not saved: take it back out and give the text back to the box.
            self.messages.removeAll { $0.id == optimisticID }
            self.input = self.input.isEmpty ? text : self.input
            self.attachments = attachments + self.attachments
            self.fail(error)
        }
    }

    private func ensureChat() async throws -> Int {
        if let chatID = self.activeChatID { return chatID }
        let chat = try await self.transport.createChat(title: nil)
        self.chats.insert(chat, at: 0)
        self.activeChatID = chat.id
        return chat.id
    }

    private func beginReply(chatID: Int, to agent: BrainChatAgent?, imageURLs: [String]) {
        let token = UUID()
        self.runToken = token
        self.isRunning = true
        self.streamingAssistantText = nil
        self.runTask = Task { [weak self] in
            guard let self else { return }
            if let agent {
                await self.awaitAgentReply(chatID: chatID, agent: agent)
            } else {
                await self.runBrainReply(chatID: chatID, imageURLs: imageURLs, token: token)
            }
            await self.finishReply(chatID: chatID, token: token)
        }
    }

    private func runBrainReply(chatID: Int, imageURLs: [String], token: UUID) async {
        do {
            try await self.transport.reply(
                chatID: chatID,
                imageURLs: imageURLs,
                approve: { [weak self] request in
                    await self?.askApproval(request) ?? false
                },
                onEvent: { [weak self] event in
                    await self?.apply(event, token: token)
                })
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            self.fail(error)
        }
    }

    /// An addressed agent answers on the platform; read the transcript until its reply lands.
    private func awaitAgentReply(chatID: Int, agent: BrainChatAgent) async {
        let before = self.messages.count
        let deadline = Date().addingTimeInterval(Self.agentReplyWait)
        while Date() < deadline, !Task.isCancelled {
            try? await Task.sleep(nanoseconds: Self.agentReplyPoll)
            guard !Task.isCancelled, self.activeChatID == chatID else { return }
            do {
                let stored = try await self.transport.messages(chatID: chatID)
                guard self.activeChatID == chatID else { return }
                let transcript = Self.transcript(stored)
                if transcript.count > before, transcript.last?.role.lowercased() == "assistant" {
                    return
                }
            } catch {
                self.fail(error)
                return
            }
        }
        if !Task.isCancelled {
            self.errorText = ChatStrings.agentNoReply(agent.name)
        }
    }

    private func finishReply(chatID: Int, token: UUID) async {
        if self.activeChatID == chatID {
            do {
                try await self.reloadMessages()
            } catch {
                chatUILogger.error("reload after reply failed \(error.localizedDescription, privacy: .public)")
            }
        }
        // A stopped reply already handed the run state back.
        guard self.runToken == token else { return }
        self.runToken = nil
        self.streamingAssistantText = nil
        self.activity = nil
        self.resolveApproval(false)
        self.isRunning = false
        self.runTask = nil
        if !self.queued.isEmpty, self.activeChatID == chatID {
            let next = self.queued.removeFirst()
            await self.performSend(text: next, takeAttachments: false)
        }
    }

    private func apply(_ event: BrainReplyEvent, token: UUID) {
        guard self.runToken == token else { return }
        switch event {
        case let .draft(text):
            self.streamingAssistantText = text
        case let .activity(label):
            self.activity = label
        }
    }

    // MARK: - Approvals

    private func askApproval(_ request: BrainToolApproval) async -> Bool {
        self.resolveApproval(false)
        return await withCheckedContinuation { continuation in
            self.approvalContinuation = continuation
            self.pendingApproval = request
            self.approvalTimeout = Task { [weak self] in
                try? await Task.sleep(nanoseconds: Self.approvalWait)
                guard !Task.isCancelled else { return }
                self?.resolveApproval(false)
            }
        }
    }

    private func resolveApproval(_ approved: Bool) {
        self.approvalTimeout?.cancel()
        self.approvalTimeout = nil
        self.pendingApproval = nil
        let continuation = self.approvalContinuation
        self.approvalContinuation = nil
        continuation?.resume(returning: approved)
    }

    // MARK: - Attachments

    public func addAttachments(urls: [URL]) {
        Task { await self.loadAttachments(urls: urls) }
    }

    public func addImageAttachment(data: Data, fileName: String, mimeType: String) {
        self.appendAttachment(url: nil, data: data, fileName: fileName, mimeType: mimeType)
    }

    public func removeAttachment(_ id: BuilderforcePendingAttachment.ID) {
        self.attachments.removeAll { $0.id == id }
    }

    private func loadAttachments(urls: [URL]) async {
        for url in urls {
            do {
                let data = try await Task.detached { try Data(contentsOf: url) }.value
                let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
                self.appendAttachment(url: url, data: data, fileName: url.lastPathComponent, mimeType: mime)
            } catch {
                self.errorText = error.localizedDescription
            }
        }
    }

    private func appendAttachment(url: URL?, data: Data, fileName: String, mimeType: String) {
        if data.count > 5_000_000 {
            self.errorText = ChatStrings.attachmentTooLarge(fileName)
            return
        }
        let isImage = (UTType(mimeType: mimeType) ?? .data).conforms(to: .image)
        self.attachments.append(BuilderforcePendingAttachment(
            url: url,
            data: data,
            fileName: fileName,
            mimeType: mimeType,
            preview: isImage ? Self.previewImage(data: data) : nil))
    }

    // MARK: - Helpers

    private func fail(_ error: any Error) {
        if let cloud = error as? CloudError, cloud == .keyRejected || cloud == .signedOut {
            self.resetChats()
            self.authState = .signedOut
        }
        self.errorText = ChatStrings.describe(error)
        chatUILogger.error("chat failed \(error.localizedDescription, privacy: .public)")
    }

    /// The stored turns as the transcript renders them: people and the Brain (or an
    /// agent, named above its words); tool and system rows stay out.
    static func transcript(_ stored: [BrainChatMessage]) -> [BuilderforceChatMessage] {
        stored.compactMap { message -> BuilderforceChatMessage? in
            let role = message.role.lowercased()
            guard role == "user" || role == "assistant" else { return nil }
            let body = message.content.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !body.isEmpty else { return nil }
            let text = message.authorName.map { "**\($0)**\n\n\(body)" } ?? body
            return BuilderforceChatMessage(
                id: Self.stableID(message.id),
                role: role,
                content: [BuilderforceChatMessageContent(type: "text", text: text, mimeType: nil, fileName: nil, content: nil)],
                timestamp: Self.timestamp(message.createdAt))
        }
    }

    private static func optimisticTurn(_ text: String) -> BuilderforceChatMessage {
        BuilderforceChatMessage(
            role: "user",
            content: [BuilderforceChatMessageContent(type: "text", text: text, mimeType: nil, fileName: nil, content: nil)],
            timestamp: Date().timeIntervalSince1970 * 1000)
    }

    /// A UUID that stays the same for the same stored message, so a reload keeps rows.
    static func stableID(_ id: Int) -> UUID {
        let value = UInt64(bitPattern: Int64(id))
        var bytes = [UInt8](repeating: 0, count: 16)
        for index in 0..<8 {
            bytes[8 + index] = UInt8((value >> (UInt64(7 - index) * 8)) & 0xFF)
        }
        bytes[6] = 0x40
        bytes[8] = (bytes[8] & 0x3F) | 0x80
        return UUID(uuid: (
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
            bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]))
    }

    private static func timestamp(_ iso: String?) -> Double? {
        guard let iso else { return nil }
        let withFraction = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
        let date = (try? withFraction.parse(iso)) ?? (try? Date.ISO8601FormatStyle().parse(iso))
        return date.map { $0.timeIntervalSince1970 * 1000 }
    }

    /// A downscaled JPEG data URL the vision model sees, for an image attachment.
    private static func visionDataURL(_ attachment: BuilderforcePendingAttachment) -> String? {
        guard (UTType(mimeType: attachment.mimeType) ?? .data).conforms(to: .image),
              let jpeg = try? JPEGTranscoder.transcodeToJPEG(
                  imageData: attachment.data,
                  maxWidthPx: 1568,
                  quality: 0.8,
                  maxBytes: 1_500_000)
        else { return nil }
        return "data:image/jpeg;base64,\(jpeg.data.base64EncodedString())"
    }

    private static func previewImage(data: Data) -> BuilderforcePlatformImage? {
        #if canImport(AppKit)
        NSImage(data: data)
        #elseif canImport(UIKit)
        UIImage(data: data)
        #else
        nil
        #endif
    }
}

extension BuilderforceChatMessage {
    /// The message's text parts, joined.
    var plainText: String {
        self.content.compactMap(\.text).joined(separator: "\n")
    }
}
