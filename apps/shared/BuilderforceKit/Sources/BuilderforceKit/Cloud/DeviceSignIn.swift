import Foundation

/// The code pair the platform hands out: the person approves `userCode` on the
/// verification page; the app polls with `deviceCode`.
public struct DeviceCode: Codable, Sendable, Equatable {
    public let deviceCode: String
    public let userCode: String
    public let verificationURI: String
    public let verificationURIComplete: String
    public let interval: Int
    public let expiresIn: Int

    enum CodingKeys: String, CodingKey {
        case deviceCode = "device_code"
        case userCode = "user_code"
        case verificationURI = "verification_uri"
        case verificationURIComplete = "verification_uri_complete"
        case interval
        case expiresIn = "expires_in"
    }

    public init(
        deviceCode: String,
        userCode: String,
        verificationURI: String,
        verificationURIComplete: String,
        interval: Int = 5,
        expiresIn: Int = 600)
    {
        self.deviceCode = deviceCode
        self.userCode = userCode
        self.verificationURI = verificationURI
        self.verificationURIComplete = verificationURIComplete
        self.interval = interval
        self.expiresIn = expiresIn
    }

    public init(from decoder: any Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.deviceCode = try container.decode(String.self, forKey: .deviceCode)
        self.userCode = try container.decode(String.self, forKey: .userCode)
        self.verificationURI = try container.decode(String.self, forKey: .verificationURI)
        self.verificationURIComplete = try container.decodeIfPresent(String.self, forKey: .verificationURIComplete)
            ?? self.verificationURI
        self.interval = try container.decodeIfPresent(Int.self, forKey: .interval) ?? 5
        self.expiresIn = try container.decodeIfPresent(Int.self, forKey: .expiresIn) ?? 600
    }

    /// The page the person opens: the one that carries the code, when the platform sent it.
    public var openURL: URL? {
        URL(string: self.verificationURIComplete) ?? URL(string: self.verificationURI)
    }
}

/// What one poll answered (RFC 8628 §3.5, as the platform speaks it).
public enum DevicePollOutcome: Sendable, Equatable {
    case approved(key: String, tenantID: Int)
    case pending
    /// Polled too soon: wait longer before the next poll.
    case slowDown
    case denied
    case expired

    /// Classify `POST /api/auth/device/token`'s answer: 200 carries the key, 428 is still
    /// waiting, 429 slow down, 403 denied, 410 expired; anything else is an error.
    public static func classify(_ response: CloudHTTPResponse) throws -> DevicePollOutcome {
        switch response.status {
        case 200..<300:
            let approved = try CloudJSON.decode(DeviceApproval.self, from: response.body)
            return .approved(key: approved.accessKey, tenantID: approved.tenantId)
        case 428:
            return .pending
        case 429:
            return .slowDown
        case 403:
            return .denied
        case 410:
            return .expired
        default:
            throw CloudError.fromStatus(response.status, body: response.body)
        }
    }
}

/// The key a poll hands over once the person approves.
private struct DeviceApproval: Decodable {
    let accessKey: String
    let tenantId: Int

    enum CodingKeys: String, CodingKey {
        case accessKey = "access_key"
        case tenantId = "tenant_id"
    }
}

/// Why a sign-in ended without a key.
public enum DeviceSignInFailure: Error, Sendable, Equatable {
    case denied
    case expired
}

/// The poll loop's state: how long to wait before the next poll and when the code
/// expires. Pure, so the loop's rules are tested without a clock or a network.
public struct DevicePollSchedule: Sendable, Equatable {
    public enum Step: Sendable, Equatable {
        case wait(seconds: Int)
        case approved(key: String, tenantID: Int)
        case failed(DeviceSignInFailure)
    }

    /// RFC 8628: each `slow_down` adds five seconds to the interval.
    static let slowDownIncrement = 5

    public private(set) var interval: Int
    public let deadline: Date

    public init(code: DeviceCode, startedAt: Date) {
        self.interval = max(1, code.interval)
        self.deadline = startedAt.addingTimeInterval(TimeInterval(max(1, code.expiresIn)))
    }

    /// What to do after a poll answered `outcome` at `now`.
    public mutating func next(after outcome: DevicePollOutcome, now: Date) -> Step {
        switch outcome {
        case let .approved(key, tenantID):
            return .approved(key: key, tenantID: tenantID)
        case .denied:
            return .failed(.denied)
        case .expired:
            return .failed(.expired)
        case .slowDown:
            self.interval += Self.slowDownIncrement
        case .pending:
            break
        }
        if now.addingTimeInterval(TimeInterval(self.interval)) >= self.deadline {
            return .failed(.expired)
        }
        return .wait(seconds: self.interval)
    }
}

/// Sign in through the browser — the platform's device flow, the one the VS Code
/// extension and the desktop apps use. `start` asks for a code pair; the person approves
/// it on `/activate`; `waitForApproval` polls until the key is handed over (exactly once).
public struct DeviceSignIn: Sendable {
    private let config: CloudConfig
    private let http: any CloudHTTPClient

    public init(config: CloudConfig, http: any CloudHTTPClient) {
        self.config = config
        self.http = http
    }

    public func start() async throws -> DeviceCode {
        let body = try CloudJSON.encode(["client": self.config.client])
        let response = try await self.http.send(self.post("/api/auth/device/code", body: body))
        return try CloudJSON.decode(DeviceCode.self, from: CloudSession.body(of: response))
    }

    public func poll(_ code: DeviceCode) async throws -> DevicePollOutcome {
        let body = try CloudJSON.encode(["device_code": code.deviceCode])
        return try await DevicePollOutcome.classify(self.http.send(self.post("/api/auth/device/token", body: body)))
    }

    /// Poll until the person approves (the key), declines or the code expires (thrown as
    /// `DeviceSignInFailure`). Cancelling the Task ends the wait.
    public func waitForApproval(_ code: DeviceCode) async throws -> (key: String, tenantID: Int) {
        var schedule = DevicePollSchedule(code: code, startedAt: Date())
        var wait = schedule.interval
        while true {
            try await Task.sleep(nanoseconds: UInt64(wait) * 1_000_000_000)
            let outcome = try await self.poll(code)
            switch schedule.next(after: outcome, now: Date()) {
            case let .wait(seconds):
                wait = seconds
            case let .approved(key, tenantID):
                return (key, tenantID)
            case let .failed(failure):
                throw failure
            }
        }
    }

    /// Revoke a key on the platform (best effort — offline still signs out here).
    public func revoke(key: String) async {
        guard let body = try? CloudJSON.encode(["apiKey": key]),
              let request = try? self.post("/api/auth/keys/revoke", body: body)
        else { return }
        _ = try? await self.http.send(request)
    }

    private func post(_ path: String, body: Data) throws -> URLRequest {
        guard let url = self.config.apiURL(path) else { throw CloudError.invalidResponse("bad path \(path)") }
        var request = URLRequest(url: url, timeoutInterval: CloudSession.apiTimeout)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = body
        return request
    }
}
