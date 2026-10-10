import Foundation

/// A tool the model asked for in one turn.
public struct CompletionToolCall: Sendable, Equatable {
    public var id: String
    public var name: String
    /// The arguments as the model wrote them (a JSON object, as text).
    public var arguments: String

    public init(id: String = "", name: String = "", arguments: String = "") {
        self.id = id
        self.name = name
        self.arguments = arguments
    }
}

/// What the model said in one turn, and the tools it asked for.
public struct CompletionTurn: Sendable, Equatable {
    public let text: String
    public let toolCalls: [CompletionToolCall]
    public let finishReason: String?
}

/// One streamed completion as its chunks arrive — the OpenAI shape every client speaks:
/// text as `delta.content`, tool calls as `delta.tool_calls` fragments stitched by index.
/// A gateway that ignores `stream` and answers with one JSON body is read the same way.
public struct CompletionAccumulator: Sendable {
    public private(set) var text = ""
    public private(set) var finishReason: String?
    public private(set) var isDone = false
    private var calls: [Int: CompletionToolCall] = [:]

    public init() {}

    /// One line of the event stream. Returns the text it added, if any; throws when the
    /// upstream failed after the stream opened. A malformed chunk is skipped, never shown.
    public mutating func feed(line: String) throws -> String? {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.hasPrefix("data:") else { return nil }
        let payload = trimmed.dropFirst("data:".count).trimmingCharacters(in: .whitespaces)
        if payload == "[DONE]" {
            self.isDone = true
            return nil
        }
        guard let data = payload.data(using: .utf8),
              let chunk = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else { return nil }
        if let error = chunk["error"] {
            let message = (error as? String)
                ?? ((error as? [String: Any])?["message"] as? String)
                ?? "unknown error"
            throw CloudError.status(
                code: 502,
                message: "the model failed mid-answer: \(message)",
                reason: "stream_failed")
        }
        let choice = (chunk["choices"] as? [[String: Any]])?.first
        if let reason = choice?["finish_reason"] as? String {
            self.finishReason = reason
        }
        let delta = choice?["delta"] as? [String: Any]
        for (position, fragment) in ((delta?["tool_calls"] as? [[String: Any]]) ?? []).enumerated() {
            let index = (fragment["index"] as? Int) ?? position
            var call = self.calls[index] ?? CompletionToolCall()
            if let id = fragment["id"] as? String, !id.isEmpty {
                call.id = id
            }
            let function = fragment["function"] as? [String: Any]
            if let name = function?["name"] as? String, !name.isEmpty {
                call.name = name
            }
            if let arguments = function?["arguments"] as? String {
                call.arguments += arguments
            }
            self.calls[index] = call
        }
        guard let piece = delta?["content"] as? String, !piece.isEmpty else { return nil }
        self.text += piece
        return piece
    }

    /// A whole (non-streamed) completion body.
    public mutating func feed(body: Data) {
        guard let object = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any],
              let choice = (object["choices"] as? [[String: Any]])?.first
        else { return }
        self.finishReason = choice["finish_reason"] as? String
        let message = choice["message"] as? [String: Any]
        self.text = (message?["content"] as? String) ?? ""
        for (position, call) in ((message?["tool_calls"] as? [[String: Any]]) ?? []).enumerated() {
            let function = call["function"] as? [String: Any]
            self.calls[(call["index"] as? Int) ?? position] = CompletionToolCall(
                id: (call["id"] as? String) ?? "",
                name: (function?["name"] as? String) ?? "",
                arguments: (function?["arguments"] as? String) ?? "")
        }
        self.isDone = true
    }

    /// The turn. A call the model sent without an id still gets one to be answered by.
    public func finish() -> CompletionTurn {
        let named = self.calls.keys.sorted().compactMap { self.calls[$0] }.filter { !$0.name.isEmpty }
        let toolCalls = named.enumerated().map { offset, call -> CompletionToolCall in
            var call = call
            if call.id.isEmpty {
                call.id = "call_\(offset)"
            }
            return call
        }
        return CompletionTurn(text: self.text, toolCalls: toolCalls, finishReason: self.finishReason)
    }
}

// MARK: - Request shapes

/// A tool as a completion request offers it.
struct CompletionTool: Encodable, Sendable, Equatable {
    struct Function: Encodable, Sendable, Equatable {
        let name: String
        let description: String
        let parameters: AnyCodable
    }

    let type = "function"
    let function: Function
}

/// One message of a completion request.
struct CompletionMessage: Encodable, Sendable {
    enum Content: Encodable, Sendable {
        case text(String)
        /// Text plus images the vision model sees (`image_url` parts).
        case parts(text: String, imageURLs: [String])

        func encode(to encoder: any Encoder) throws {
            switch self {
            case let .text(text):
                var container = encoder.singleValueContainer()
                try container.encode(text)
            case let .parts(text, imageURLs):
                var container = encoder.unkeyedContainer()
                try container.encode(Part(type: "text", text: text, imageURL: nil))
                for url in imageURLs {
                    try container.encode(Part(type: "image_url", text: nil, imageURL: Part.ImageURL(url: url)))
                }
            }
        }

        private struct Part: Encodable {
            struct ImageURL: Encodable { let url: String }

            let type: String
            let text: String?
            let imageURL: ImageURL?

            enum CodingKeys: String, CodingKey {
                case type
                case text
                case imageURL = "image_url"
            }
        }
    }

    struct ToolCall: Encodable, Sendable {
        struct Function: Encodable, Sendable {
            let name: String
            let arguments: String
        }

        let id: String
        let type = "function"
        let function: Function
    }

    let role: String
    let content: Content?
    let toolCalls: [ToolCall]?
    let toolCallID: String?

    enum CodingKeys: String, CodingKey {
        case role
        case content
        case toolCalls = "tool_calls"
        case toolCallID = "tool_call_id"
    }

    init(role: String, content: Content?, toolCalls: [ToolCall]? = nil, toolCallID: String? = nil) {
        self.role = role
        self.content = content
        self.toolCalls = toolCalls
        self.toolCallID = toolCallID
    }
}

/// The body of `POST /llm/v1/chat/completions`.
struct CompletionRequest: Encodable, Sendable {
    let messages: [CompletionMessage]
    let tools: [CompletionTool]?
    let stream = true
}
