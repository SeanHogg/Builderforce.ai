import Foundation
import Testing
@testable import CoderClaw

@Suite(.serialized)
struct CoderClawConfigFileTests {
    @Test
    func configPathRespectsEnvOverride() async {
        let override = FileManager().temporaryDirectory
            .appendingPathComponent("coderclaw-config-\(UUID().uuidString)")
            .appendingPathComponent("coderclaw.json")
            .path

        await TestIsolation.withEnvValues(["CODERCLAW_CONFIG_PATH": override]) {
            #expect(CoderClawConfigFile.url().path == override)
        }
    }

    @MainActor
    @Test
    func remoteGatewayPortParsesAndMatchesHost() async {
        let override = FileManager().temporaryDirectory
            .appendingPathComponent("coderclaw-config-\(UUID().uuidString)")
            .appendingPathComponent("coderclaw.json")
            .path

        await TestIsolation.withEnvValues(["CODERCLAW_CONFIG_PATH": override]) {
            CoderClawConfigFile.saveDict([
                "gateway": [
                    "remote": [
                        "url": "ws://gateway.ts.net:19999",
                    ],
                ],
            ])
            #expect(CoderClawConfigFile.remoteGatewayPort() == 19999)
            #expect(CoderClawConfigFile.remoteGatewayPort(matchingHost: "gateway.ts.net") == 19999)
            #expect(CoderClawConfigFile.remoteGatewayPort(matchingHost: "gateway") == 19999)
            #expect(CoderClawConfigFile.remoteGatewayPort(matchingHost: "other.ts.net") == nil)
        }
    }

    @MainActor
    @Test
    func setRemoteGatewayUrlPreservesScheme() async {
        let override = FileManager().temporaryDirectory
            .appendingPathComponent("coderclaw-config-\(UUID().uuidString)")
            .appendingPathComponent("coderclaw.json")
            .path

        await TestIsolation.withEnvValues(["CODERCLAW_CONFIG_PATH": override]) {
            CoderClawConfigFile.saveDict([
                "gateway": [
                    "remote": [
                        "url": "wss://old-host:111",
                    ],
                ],
            ])
            CoderClawConfigFile.setRemoteGatewayUrl(host: "new-host", port: 2222)
            let root = CoderClawConfigFile.loadDict()
            let url = ((root["gateway"] as? [String: Any])?["remote"] as? [String: Any])?["url"] as? String
            #expect(url == "wss://new-host:2222")
        }
    }

    @Test
    func stateDirOverrideSetsConfigPath() async {
        let dir = FileManager().temporaryDirectory
            .appendingPathComponent("coderclaw-state-\(UUID().uuidString)", isDirectory: true)
            .path

        await TestIsolation.withEnvValues([
            "CODERCLAW_CONFIG_PATH": nil,
            "CODERCLAW_STATE_DIR": dir,
        ]) {
            #expect(CoderClawConfigFile.stateDirURL().path == dir)
            #expect(CoderClawConfigFile.url().path == "\(dir)/coderclaw.json")
        }
    }

    @MainActor
    @Test
    func saveDictAppendsConfigAuditLog() async throws {
        let stateDir = FileManager().temporaryDirectory
            .appendingPathComponent("coderclaw-state-\(UUID().uuidString)", isDirectory: true)
        let configPath = stateDir.appendingPathComponent("coderclaw.json")
        let auditPath = stateDir.appendingPathComponent("logs/config-audit.jsonl")

        defer { try? FileManager().removeItem(at: stateDir) }

        try await TestIsolation.withEnvValues([
            "CODERCLAW_STATE_DIR": stateDir.path,
            "CODERCLAW_CONFIG_PATH": configPath.path,
        ]) {
            CoderClawConfigFile.saveDict([
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
            #expect(auditRoot?["source"] as? String == "macos-coderclaw-config-file")
            #expect(auditRoot?["event"] as? String == "config.write")
            #expect(auditRoot?["result"] as? String == "success")
            #expect(auditRoot?["configPath"] as? String == configPath.path)
        }
    }
}
