import Foundation

/// A tool the Brain wants to run that changes something — shown to the person, who
/// approves or declines it.
public struct BrainToolApproval: Sendable, Equatable, Identifiable {
    public let id: String
    /// What it does, as a person reads it (`tasks create`).
    public let label: String
    /// Its arguments (JSON text).
    public let arguments: String

    public init(id: String, label: String, arguments: String) {
        self.id = id
        self.label = label
        self.arguments = arguments
    }
}

/// The reply's progress, as the window shows it.
public enum BrainReplyEvent: Sendable, Equatable {
    /// The answer so far (the whole draft, not a delta).
    case draft(String)
    /// The tool in use (`nil` once it returned).
    case activity(String?)
}

/// The Brain's reply in a chat. The platform answers only messages addressed to an agent;
/// the Brain's own turn is run by the surface the person is in — the web page, the
/// extension, Synapse, and here — through the same loop: the model streams its answer and
/// may call the platform's tools, each run on the platform as the person. A tool that only
/// reads runs at once; one that changes something waits for the person's approval.
///
/// Cancelling the Task stops the reply; what was written so far is kept in the chat.
public struct BrainReplyRunner: Sendable {
    /// How much of the conversation the Brain reads.
    public static let historyWindow = 24
    /// The platform catalog the Brain is offered.
    public static let toolSurface = "delivery"
    /// How much of one tool's result the model reads back.
    public static let resultCharacters = 16000
    /// Tool calls failing this many times in a row end the tools for this reply: the model
    /// answers with what it has instead of retrying forever.
    public static let failureStreak = 5
    /// One model turn: the longest a reasoning model with tools takes to finish.
    static let turnTimeout: TimeInterval = 300

    static let systemPrompt = """
    You are the Brain in the Builderforce app on the person's phone or computer. Answer directly and \
    concisely. You can see the conversation. You have the workspace's platform tools \
    (`builtin_<domain>_<method>`: projects, tickets, boards, specs, OKRs, and the workspace's connectors). \
    Resolve names to ids with the list/get tools before acting. Read-only tools run at once; a tool that \
    changes something is shown to the person to approve, so call it directly when you have the details — \
    if they decline you get `{"cancelled": true}`, so adjust rather than retry. Never say you did something \
    unless the tool returned success. Code work and long-running work belong to an assigned agent: say which \
    one should take it, or suggest assigning one, and the person can address it with "To".
    """

    private let session: CloudSession
    private let chats: BrainChatAPI
    private let tools: PlatformToolsClient

    public init(session: CloudSession) {
        self.session = session
        self.chats = BrainChatAPI(session: session)
        self.tools = PlatformToolsClient(session: session)
    }

    /// Answer the latest user turn of `chatID`, then persist the answer. `imageURLs` are
    /// images on that turn the model should see (data or signed URLs).
    public func run(
        chatID: Int,
        imageURLs: [String] = [],
        approve: @escaping @Sendable (BrainToolApproval) async -> Bool,
        onEvent: @escaping @Sendable (BrainReplyEvent) async -> Void) async throws
    {
        let history = try await self.chats.messages(chatID: chatID, limit: Self.historyWindow)
        var prompt = Self.conversation(history, imageURLs: imageURLs)
        guard prompt.contains(where: { $0.role == "user" }) else { return }
        prompt.insert(CompletionMessage(role: "system", content: .text(Self.systemPrompt)), at: 0)

        // The tools, likewise: an unreachable catalog is an answer without them.
        let catalog: [PlatformTool]
        do {
            catalog = try await self.tools.tools(surface: Self.toolSurface)
        } catch CloudError.keyRejected {
            throw CloudError.keyRejected
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            catalog = []
        }

        var loop = ReplyLoop(catalog: catalog, prompt: prompt)
        do {
            try await self.converse(&loop, approve: approve, onEvent: onEvent)
        } catch {
            if Self.isCancellation(error) {
                await self.keepStopped(draft: loop.draft, chatID: chatID)
            }
            throw error
        }

        let answer = loop.draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !answer.isEmpty else {
            throw CloudError.invalidResponse("the model returned an empty answer")
        }
        try await self.chats.appendAssistant(chatID: chatID, content: answer)
    }

    // MARK: - The loop

    private struct ReplyLoop {
        let catalog: [PlatformTool]
        var prompt: [CompletionMessage]
        var offerTools: Bool
        var draft = ""
        var failures = 0

        init(catalog: [PlatformTool], prompt: [CompletionMessage]) {
            self.catalog = catalog
            self.prompt = prompt
            self.offerTools = !catalog.isEmpty
        }
    }

    private func converse(
        _ loop: inout ReplyLoop,
        approve: @escaping @Sendable (BrainToolApproval) async -> Bool,
        onEvent: @escaping @Sendable (BrainReplyEvent) async -> Void) async throws
    {
        while true {
            try Task.checkCancellation()
            let offered = loop.offerTools ? loop.catalog.map(\.asFunction) : nil
            // Each round's text continues the same reply, a paragraph apart.
            let prefix = loop.draft.isEmpty ? "" : loop.draft + "\n\n"
            var roundText = ""
            let turn = try await self.streamTurn(
                CompletionRequest(messages: loop.prompt, tools: offered))
            { piece in
                roundText += piece
                await onEvent(.draft(prefix + roundText))
            }
            if !roundText.isEmpty {
                loop.draft = prefix + roundText
            }
            guard loop.offerTools, !turn.toolCalls.isEmpty else { return }

            loop.prompt.append(CompletionMessage(
                role: "assistant",
                content: .text(turn.text),
                toolCalls: turn.toolCalls.map {
                    CompletionMessage.ToolCall(id: $0.id, function: .init(name: $0.name, arguments: $0.arguments))
                }))
            for call in turn.toolCalls {
                let content = try await self.runTool(call, loop: &loop, approve: approve, onEvent: onEvent)
                loop.prompt.append(CompletionMessage(role: "tool", content: .text(content), toolCallID: call.id))
            }
            if loop.failures >= Self.failureStreak {
                // The next round answers without tools, from what the calls returned.
                loop.offerTools = false
            }
        }
    }

    /// One tool call's answer for the model.
    private func runTool(
        _ call: CompletionToolCall,
        loop: inout ReplyLoop,
        approve: @escaping @Sendable (BrainToolApproval) async -> Bool,
        onEvent: @escaping @Sendable (BrainReplyEvent) async -> Void) async throws -> String
    {
        guard let tool = loop.catalog.first(where: { $0.name == call.name }) else {
            loop.failures += 1
            return Self.errorJSON("there is no tool named \(call.name)")
        }
        guard let arguments = Self.argumentObject(call.arguments) else {
            loop.failures += 1
            return Self.errorJSON("the arguments for \(call.name) are not a JSON object")
        }
        if tool.writes {
            let request = BrainToolApproval(id: call.id, label: tool.label, arguments: call.arguments)
            guard await approve(request) else {
                try Task.checkCancellation()
                return #"{"cancelled":true,"reason":"the person declined this action"}"#
            }
        }
        await onEvent(.activity(tool.label))
        let outcome: Result<String, any Error>
        do {
            outcome = try await .success(self.tools.call(tool, arguments: arguments))
        } catch {
            outcome = .failure(error)
        }
        await onEvent(.activity(nil))
        switch outcome {
        case let .success(output):
            loop.failures = 0
            return String(output.prefix(Self.resultCharacters))
        case let .failure(error):
            if Self.isCancellation(error) || (error as? CloudError) == .keyRejected { throw error }
            loop.failures += 1
            return Self.errorJSON(error.localizedDescription)
        }
    }

    /// Run one model turn, handing each piece of text to `onText` as it arrives.
    private func streamTurn(
        _ body: CompletionRequest,
        onText: (String) async -> Void) async throws -> CompletionTurn
    {
        let request = try self.session.gatewayRequest(
            method: "POST",
            path: "/chat/completions",
            body: CloudJSON.encode(body),
            timeout: Self.turnTimeout)
        var accumulator = CompletionAccumulator()
        let response = try await self.session.http.stream(request) { line in
            if let piece = try accumulator.feed(line: line) {
                await onText(piece)
            }
        }
        if response.status == 401 { throw CloudError.keyRejected }
        guard response.isSuccess else { throw CloudError.fromStatus(response.status, body: response.body) }
        if !response.body.isEmpty {
            accumulator.feed(body: response.body)
            if !accumulator.text.isEmpty {
                await onText(accumulator.text)
            }
        }
        return accumulator.finish()
    }

    /// A stopped reply keeps what was written: the partial answer is persisted even
    /// though the Task that wrote it is cancelled.
    private func keepStopped(draft: String, chatID: Int) async {
        let partial = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !partial.isEmpty else { return }
        let chats = self.chats
        let persist = Task { try? await chats.appendAssistant(chatID: chatID, content: partial) }
        await persist.value
    }

    // MARK: - Helpers

    /// The conversation so far, as the model reads it: the last `historyWindow` user and
    /// assistant turns. Another participant's reply is shown as theirs (`[Name] …`); the
    /// latest user turn carries `imageURLs` when there are any.
    static func conversation(_ messages: [BrainChatMessage], imageURLs: [String] = []) -> [CompletionMessage] {
        var turns: [(role: String, text: String)] = []
        for message in messages.suffix(Self.historyWindow) {
            let content = message.content.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !content.isEmpty, message.role == "user" || message.role == "assistant" else { continue }
            let text = message.authorName.map { "[\($0)] \(content)" } ?? content
            turns.append((message.role, text))
        }
        let lastUser = turns.lastIndex { $0.role == "user" }
        return turns.enumerated().map { index, turn in
            if index == lastUser, !imageURLs.isEmpty {
                return CompletionMessage(role: turn.role, content: .parts(text: turn.text, imageURLs: imageURLs))
            }
            return CompletionMessage(role: turn.role, content: .text(turn.text))
        }
    }

    static func argumentObject(_ text: String) -> AnyCodable? {
        let source = text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "{}" : text
        guard let decoded = try? JSONDecoder().decode(AnyCodable.self, from: Data(source.utf8)),
              decoded.value is [String: AnyCodable]
        else { return nil }
        return decoded
    }

    private static func errorJSON(_ message: String) -> String {
        let encoded = (try? CloudJSON.encode(["error": message])).map { String(decoding: $0, as: UTF8.self) }
        return encoded ?? #"{"error":"tool failed"}"#
    }

    private static func isCancellation(_ error: any Error) -> Bool {
        error is CancellationError || (error as? URLError)?.code == .cancelled
    }
}
