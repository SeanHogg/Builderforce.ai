import Foundation

public enum BuilderforceChatTransportEvent: Sendable {
    case health(ok: Bool)
    case tick
    case chat(BuilderforceChatEventPayload)
    case agent(BuilderforceAgentEventPayload)
    case seqGap
}

public protocol BuilderforceChatTransport: Sendable {
    func requestHistory(sessionKey: String) async throws -> BuilderforceChatHistoryPayload
    func sendMessage(
        sessionKey: String,
        message: String,
        thinking: String,
        idempotencyKey: String,
        attachments: [BuilderforceChatAttachmentPayload]) async throws -> BuilderforceChatSendResponse

    func abortRun(sessionKey: String, runId: String) async throws
    func listSessions(limit: Int?) async throws -> BuilderforceChatSessionsListResponse

    func requestHealth(timeoutMs: Int) async throws -> Bool
    func events() -> AsyncStream<BuilderforceChatTransportEvent>

    func setActiveSessionKey(_ sessionKey: String) async throws
}

extension BuilderforceChatTransport {
    public func setActiveSessionKey(_: String) async throws {}

    public func abortRun(sessionKey _: String, runId _: String) async throws {
        throw NSError(
            domain: "BuilderforceChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "chat.abort not supported by this transport"])
    }

    public func listSessions(limit _: Int?) async throws -> BuilderforceChatSessionsListResponse {
        throw NSError(
            domain: "BuilderforceChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "sessions.list not supported by this transport"])
    }
}
