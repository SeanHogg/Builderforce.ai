import Foundation

/// Where the apps reach Builderforce and who they are to it — the same gateway the web
/// app, the VS Code extension and the desktop apps (Synapse, Spawn) use.
///
/// The base is `BUILDERFORCE_URL` when set (a local or staging platform), else
/// production, exactly like the desktop client's `gateway_base()`.
public struct CloudConfig: Sendable, Equatable {
    public static let productionGateway = "https://builderforce.ai/gateway"
    public static let keychainService = "ai.builderforce.cloud"
    public static let keychainAccount = "apiKey"

    /// The gateway every API and LLM call goes through, without a trailing slash.
    public let gatewayBase: String
    /// How the app names itself to the device flow (`DEVICE_CLIENTS` on the platform).
    public let client: String
    public let keychainService: String
    public let keychainAccount: String

    public init(
        gatewayBase: String,
        client: String,
        keychainService: String = CloudConfig.keychainService,
        keychainAccount: String = CloudConfig.keychainAccount)
    {
        self.gatewayBase = Self.trimmedBase(gatewayBase)
        self.client = client
        self.keychainService = keychainService
        self.keychainAccount = keychainAccount
    }

    /// The configuration for this app on this platform.
    public static func current(environment: [String: String] = ProcessInfo.processInfo.environment) -> CloudConfig {
        CloudConfig(gatewayBase: self.gatewayBase(environment: environment), client: self.platformClient)
    }

    /// `BUILDERFORCE_URL`, else production.
    public static func gatewayBase(environment: [String: String]) -> String {
        let override = environment["BUILDERFORCE_URL"]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return self.trimmedBase(override.isEmpty ? self.productionGateway : override)
    }

    public static var platformClient: String {
        #if os(iOS)
        "ios"
        #elseif os(macOS)
        "macos"
        #else
        "builderforce"
        #endif
    }

    /// The web app's origin, for links a person opens: the gateway host without its path
    /// and without a leading `api.`.
    public var webBase: String {
        let parts = self.gatewayBase.components(separatedBy: "://")
        let scheme = parts.count > 1 ? parts[0] : "https"
        let rest = parts.count > 1 ? parts[1] : parts[0]
        var host = rest.split(separator: "/", maxSplits: 1).first.map(String.init) ?? rest
        if host.hasPrefix("api.") {
            host.removeFirst(4)
        }
        return "\(scheme)://\(host)"
    }

    /// A platform API URL (`path` starts with `/api/…`, query included).
    public func apiURL(_ path: String) -> URL? {
        URL(string: self.gatewayBase + path)
    }

    /// An LLM-gateway URL (`/llm/v1` + `path`).
    public func llmURL(_ path: String) -> URL? {
        URL(string: self.gatewayBase + "/llm/v1" + path)
    }

    private static func trimmedBase(_ raw: String) -> String {
        var base = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        while base.hasSuffix("/") {
            base.removeLast()
        }
        return base
    }
}
