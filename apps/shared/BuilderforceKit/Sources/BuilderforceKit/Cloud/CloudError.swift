import Foundation

/// Why a call to Builderforce did not succeed — split the way a window must react: a
/// refused key signs out, an unreachable platform keeps the session and says so.
public enum CloudError: Error, Sendable, Equatable {
    /// Nobody is signed in.
    case signedOut
    /// The platform refused the saved key (revoked or deleted): sign in again.
    case keyRejected
    /// The platform could not be reached (offline, DNS, timeout).
    case unreachable(String)
    /// The platform answered with an error. `reason` is the body's stable `code`, when it
    /// sent one (`membership_required`, `insufficient_tokens`, …).
    case status(code: Int, message: String, reason: String?)
    /// The platform answered with something this client cannot read.
    case invalidResponse(String)

    public var isUnauthorized: Bool {
        if case .status(code: 401, message: _, reason: _) = self { return true }
        return false
    }

    /// A non-2xx answer, classified. The body's `error` field is the platform's message.
    public static func fromStatus(_ code: Int, body: Data) -> CloudError {
        let object = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any]
        let message = (object?["error"] as? String)
            ?? String(String(decoding: body, as: UTF8.self).prefix(200))
        return .status(code: code, message: message, reason: object?["code"] as? String)
    }

    /// A transport failure (no answer at all), classified. Cancellation passes through.
    public static func wrap(_ error: any Error) -> any Error {
        if error is CloudError || error is CancellationError { return error }
        if let urlError = error as? URLError {
            if urlError.code == .cancelled { return CancellationError() }
            return CloudError.unreachable(urlError.localizedDescription)
        }
        return CloudError.unreachable(error.localizedDescription)
    }
}

extension CloudError: LocalizedError {
    /// Developer-facing text (logs). The chat UI words these for people itself.
    public var errorDescription: String? {
        switch self {
        case .signedOut:
            "not signed in to Builderforce"
        case .keyRejected:
            "Builderforce no longer accepts this sign-in; sign in again"
        case let .unreachable(detail):
            "Builderforce could not be reached: \(detail)"
        case let .status(code, message, _):
            "Builderforce answered \(code): \(message)"
        case let .invalidResponse(detail):
            "Builderforce sent an unexpected answer: \(detail)"
        }
    }
}
