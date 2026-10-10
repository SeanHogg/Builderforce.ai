import Foundation
import Testing
@testable import Builderforce

@Suite(.serialized)
struct BuilderforceConfigFileTests {
    @Test
    func configPathRespectsEnvOverride() async {
        let override = FileManager().temporaryDirectory
            .appendingPathComponent("builderforce-config-\(UUID().uuidString)")
            .appendingPathComponent("builderforce.json")
            .path

        await TestIsolation.withEnvValues(["BUILDERFORCE_AGENTS_CONFIG_PATH": override]) {
            #expect(BuilderforceConfigFile.url().path == override)
        }
    }

    @MainActor
    @Test
    func remoteGatewayPortParsesAndMatchesHost() async {
        let override = FileManager().temporaryDirectory
            .appendingPathComponent("builderforce-config-\(UUID().uuidString)")
            .appendingPathComponent("builderforce.json")
            .path

        await TestIsolation.withEnvValues(["BUILDERFORCE_AGENTS_CONFIG_PATH": override]) {
            BuilderforceConfigFile.saveDict([
                "gateway": [
                    "remote": [
                        "url": "ws://gateway.ts.net:19999",
                    ],
                ],
            ])
            #expect(BuilderforceConfigFile.remoteGatewayPort() == 19999)
            #expect(BuilderforceConfigFile.remoteGatewayPort(matchingHost: "gateway.ts.net") == 19999)
            #expect(BuilderforceConfigFile.remoteGatewayPort(matchingHost: "gateway") == 19999)
            #expect(BuilderforceConfigFile.remoteGatewayPort(matchingHost: "other.ts.net") == nil)
        }
    }

    @MainActor
    @Test
    func setRemoteGatewayUrlPreservesScheme() async {
        let override = FileManager().temporaryDirectory
            .appendingPathComponent("builderforce-config-\(UUID().uuidString)")
            .appendingPathComponent("builderforce.json")
            .path

        await TestIsolation.withEnvValues(["BUILDERFORCE_AGENTS_CONFIG_PATH": override]) {
            BuilderforceConfigFile.saveDict([
                "gateway": [
                    "remote": [
                        "url": "wss://old-host:111",
                    ],
                ],
            ])
            BuilderforceConfigFile.setRemoteGatewayUrl(host: "new-host", port: 2222)
            let root = BuilderforceConfigFile.loadDict()
            let url = ((root["gateway"] as? [String: Any])?["remote"] as? [String: Any])?["url"] as? String
            #expect(url == "wss://new-host:2222")
        }
    }

    @Test
    func stateDirOverrideSetsConfigPath() async {
        let dir = FileManager().temporaryDirectory
            .appendingPathComponent("builderforce-state-\(UUID().uuidString)", isDirectory: true)
            .path

        await TestIsolation.withEnvValues([
            "BUILDERFORCE_AGENTS_CONFIG_PATH": nil,
            "BUILDERFORCE_AGENTS_STATE_DIR": dir,
        ]) {
            #expect(BuilderforceConfigFile.stateDirURL().path == dir)
            #expect(BuilderforceConfigFile.url().path == "\(dir)/builderforce.json")
        }
    }

    @MainActor
    @Test
    func saveDictAppendsConfigAuditLog() async throws {
        let stateDir = FileManager().temporaryDirectory
            .appendingPathComponent("builderforce-state-\(UUID().uuidString)", isDirectory: true)
        let configPath = stateDir.appendingPathComponent("builderforce.json")
        let auditPath = stateDir.appendingPathComponent("logs/config-audit.jsonl")

        defer { try? FileManager().removeItem(at: stateDir) }

        try await TestIsolation.withEnvValues([
            "BUILDERFORCE_AGENTS_STATE_DIR": stateDir.path,
            "BUILDERFORCE_AGENTS_CONFIG_PATH": configPath.path,
        ]) {
            BuilderforceConfigFile.saveDict([
                "gateway": ["mode": "local"],
            ])

            let configData = try Data(contentsOf: configPath)
            let configRoot = try JSONSerialization.jsonObject(with: configData) as? [String: Any]
            #expect((configRoot?["meta"] as? [String: Any]) != nil)

            let rawAudit = try String(contentsOf: auditPath, encoding: .utf8)
            let lines = rawAudit
                .split(whereSeparator: \.isNewline)
                .map(String.init)
            #expect(!lines.isEmpty)
            guard let last = lines.last else {
                Issue.record("Missing config audit line")
                return
            }
            let auditRoot = try JSONSerialization.jsonObject(with: Data(last.utf8)) as? [String: Any]
            #expect(auditRoot?["source"] as? String == "macos-builderforce-config-file")
            #expect(auditRoot?["event"] as? String == "config.write")
            #expect(auditRoot?["result"] as? String == "success")
            #expect(auditRoot?["configPath"] as? String == configPath.path)
        }
    }
}
