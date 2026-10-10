import Foundation

/// The signed-in state every surface of the app shares: the `bfk_` key in the Keychain
/// (service `ai.builderforce.cloud`), the session made from it, and the device-flow
/// sign-in that gets it. A key the platform refuses is forgotten here, so the next call
/// reads as signed out rather than failing forever.
public actor CloudAccount {
    /// The app's one account (both chat surfaces on a platform share it).
    public static let shared = CloudAccount(config: .current(), http: URLSessionCloudHTTPClient())

    public nonisolated let config: CloudConfig
    public nonisolated let http: any CloudHTTPClient
    private let keyStore: CloudKeyStore
    private var session: CloudSession?

    public init(config: CloudConfig, http: any CloudHTTPClient, keyStore: CloudKeyStore? = nil) {
        self.config = config
        self.http = http
        self.keyStore = keyStore ?? .keychain(service: config.keychainService, account: config.keychainAccount)
    }

    public var isSignedIn: Bool {
        self.currentSession() != nil
    }

    /// The session to call the platform with; `CloudError.signedOut` when there is none.
    public func requireSession() throws -> CloudSession {
        guard let session = self.currentSession() else { throw CloudError.signedOut }
        return session
    }

    /// Ask the platform for a code pair the person approves in the browser.
    public func startSignIn() async throws -> DeviceCode {
        try await DeviceSignIn(config: self.config, http: self.http).start()
    }

    /// Wait for the person to approve `code`, then keep the key. Cancel the Task to stop.
    public func finishSignIn(_ code: DeviceCode) async throws {
        let approved = try await DeviceSignIn(config: self.config, http: self.http).waitForApproval(code)
        self.keyStore.save(approved.key)
        self.session = CloudSession(apiKey: approved.key, config: self.config, http: self.http)
    }

    /// Forget the key here and revoke it on the platform (best effort).
    public func signOut() async {
        let key = self.session?.apiKey ?? self.keyStore.load()
        self.forget()
        if let key {
            await DeviceSignIn(config: self.config, http: self.http).revoke(key: key)
        }
    }

    /// Run `body` with the session; a refused key signs out before the error goes on.
    public func withSession<T: Sendable>(
        _ body: @Sendable (CloudSession) async throws -> T) async throws -> T
    {
        let session = try self.requireSession()
        do {
            return try await body(session)
        } catch CloudError.keyRejected {
            self.forget()
            throw CloudError.keyRejected
        }
    }

    private func forget() {
        self.keyStore.delete()
        self.session = nil
    }

    private func currentSession() -> CloudSession? {
        if let session = self.session { return session }
        guard let key = self.keyStore.load() else { return nil }
        let session = CloudSession(apiKey: key, config: self.config, http: self.http)
        self.session = session
        return session
    }
}

/// Where the sign-in key is kept: the Keychain in the app, memory in tests.
public struct CloudKeyStore: Sendable {
    let load: @Sendable () -> String?
    let save: @Sendable (String) -> Void
    let delete: @Sendable () -> Void

    public init(
        load: @escaping @Sendable () -> String?,
        save: @escaping @Sendable (String) -> Void,
        delete: @escaping @Sendable () -> Void)
    {
        self.load = load
        self.save = save
        self.delete = delete
    }

    public static func keychain(service: String, account: String) -> CloudKeyStore {
        CloudKeyStore(
            load: {
                let key = KeychainStore.loadString(service: service, account: account)?
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                return (key?.isEmpty ?? true) ? nil : key
            },
            save: { KeychainStore.saveString($0, service: service, account: account) },
            delete: { KeychainStore.delete(service: service, account: account) })
    }
}
