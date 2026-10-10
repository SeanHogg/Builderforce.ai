import Foundation
import Testing
@testable import Builderforce

@Suite
struct BuilderforceOAuthStoreTests {
    @Test
    func returnsMissingWhenFileAbsent() {
        let url = FileManager().temporaryDirectory
            .appendingPathComponent("builderforce-oauth-\(UUID().uuidString)")
            .appendingPathComponent("oauth.json")
        #expect(BuilderforceOAuthStore.anthropicOAuthStatus(at: url) == .missingFile)
    }

    @Test
    func usesEnvOverrideForBuilderforceOAuthDir() throws {
        let key = "BUILDERFORCE_AGENTS_OAUTH_DIR"
        let previous = ProcessInfo.processInfo.environment[key]
        defer {
            if let previous {
                setenv(key, previous, 1)
            } else {
                unsetenv(key)
            }
        }

        let dir = FileManager().temporaryDirectory
            .appendingPathComponent("builderforce-oauth-\(UUID().uuidString)", isDirectory: true)
        setenv(key, dir.path, 1)

        #expect(BuilderforceOAuthStore.oauthDir().standardizedFileURL == dir.standardizedFileURL)
    }

    @Test
    func acceptsPiFormatTokens() throws {
        let url = try self.writeOAuthFile([
            "anthropic": [
                "type": "oauth",
                "refresh": "r1",
                "access": "a1",
                "expires": 1_234_567_890,
            ],
        ])

        #expect(BuilderforceOAuthStore.anthropicOAuthStatus(at: url).isConnected)
    }

    @Test
    func acceptsTokenKeyVariants() throws {
        let url = try self.writeOAuthFile([
            "anthropic": [
                "type": "oauth",
                "refresh_token": "r1",
                "access_token": "a1",
            ],
        ])

        #expect(BuilderforceOAuthStore.anthropicOAuthStatus(at: url).isConnected)
    }

    @Test
    func reportsMissingProviderEntry() throws {
        let url = try self.writeOAuthFile([
            "other": [
                "type": "oauth",
                "refresh": "r1",
                "access": "a1",
            ],
        ])

        #expect(BuilderforceOAuthStore.anthropicOAuthStatus(at: url) == .missingProviderEntry)
    }

    @Test
    func reportsMissingTokens() throws {
        let url = try self.writeOAuthFile([
            "anthropic": [
                "type": "oauth",
                "refresh": "",
                "access": "a1",
            ],
        ])

        #expect(BuilderforceOAuthStore.anthropicOAuthStatus(at: url) == .missingTokens)
    }

    private func writeOAuthFile(_ json: [String: Any]) throws -> URL {
        let dir = FileManager().temporaryDirectory
            .appendingPathComponent("builderforce-oauth-\(UUID().uuidString)", isDirectory: true)
        try FileManager().createDirectory(at: dir, withIntermediateDirectories: true)

        let url = dir.appendingPathComponent("oauth.json")
        let data = try JSONSerialization.data(withJSONObject: json, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: url, options: [.atomic])
        return url
    }
}
