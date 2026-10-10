import Foundation

public enum CoderClawBonjour {
    /// DNS-SD service types a gateway can advertise, current first. The runtime advertises
    /// `_builderforce-gw._tcp`; older runtimes advertise the pre-rebrand type, so discovery
    /// browses both. This is the one list for iOS and macOS.
    public static let gatewayServiceTypes = ["_builderforce-gw._tcp", "_coderclaw-gw._tcp"]
    public static let gatewayServiceDomain = "local."

    /// One Bonjour browse: a gateway service type in a domain.
    public struct BrowseTarget: Hashable, Sendable {
        public let serviceType: String
        public let domain: String

        /// Stable key for per-browser state (`<type>|<domain>`).
        public var key: String {
            "\(self.serviceType)|\(self.domain)"
        }
    }

    /// Every gateway service type in every browsed domain.
    public static var gatewayBrowseTargets: [BrowseTarget] {
        self.gatewayServiceDomains.flatMap { domain in
            self.gatewayServiceTypes.map { BrowseTarget(serviceType: $0, domain: domain) }
        }
    }

    public static var wideAreaGatewayServiceDomain: String? {
        let env = ProcessInfo.processInfo.environment
        return resolveWideAreaDomain(env["CODERCLAW_WIDE_AREA_DOMAIN"])
    }

    public static var gatewayServiceDomains: [String] {
        var domains = [gatewayServiceDomain]
        if let wideArea = wideAreaGatewayServiceDomain {
            domains.append(wideArea)
        }
        return domains
    }

    private static func resolveWideAreaDomain(_ raw: String?) -> String? {
        let trimmed = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }
        let normalized = normalizeServiceDomain(trimmed)
        return normalized == gatewayServiceDomain ? nil : normalized
    }

    public static func normalizeServiceDomain(_ raw: String?) -> String {
        let trimmed = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return self.gatewayServiceDomain
        }

        let lower = trimmed.lowercased()
        if lower == "local" || lower == "local." {
            return self.gatewayServiceDomain
        }

        return lower.hasSuffix(".") ? lower : (lower + ".")
    }
}
