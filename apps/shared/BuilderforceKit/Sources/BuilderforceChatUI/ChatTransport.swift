import Foundation

public enum CoderClawChatTransportEvent: Sendable {
    case health(ok: Bool)
    case tick
    case chat(CoderClawChatEventPayload)
    case agent(CoderClawAgentEventPayload)
    case seqGap
}

public protocol CoderClawChatTransport: Sendable {
    func requestHistory(sessionKey: String) async throws -> CoderClawChatHistoryPayload
    func sendMessage(
        sessionKey: String,
        message: String,
        thinking: String,
        idempotencyKey: String,
        attachments: [CoderClawChatAttachmentPayload]) async throws -> CoderClawChatSendResponse

    func abortRun(sessionKey: String, runId: String) async throws
    func listSessions(limit: Int?) async throws -> CoderClawChatSessionsListResponse

    func requestHealth(timeoutMs: Int) async throws -> Bool
    func events() -> AsyncStream<CoderClawChatTransportEvent>

    func setActiveSessionKey(_ sessionKey: String) async throws
}

extension CoderClawChatTransport {
    public func setActiveSessionKey(_: String) async throws {}

    public func abortRun(sessionKey _: String, runId _: String) async throws {
        throw NSError(
            domain: "CoderClawChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "chat.abort not supported by this transport"])
    }

    public func listSessions(limit _: Int?) async throws -> CoderClawChatSessionsListResponse {
        throw NSError(
            domain: "CoderClawChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "sessions.list not supported by this transport"])
    }
}
