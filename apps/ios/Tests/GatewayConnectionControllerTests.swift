import CoderClawKit
import Foundation
import Testing
import UIKit
@testable import CoderClaw

private func withUserDefaults<T>(_ updates: [String: Any?], _ body: () throws -> T) rethrows -> T {
    let defaults = UserDefaults.standard
    var snapshot: [String: Any?] = [:]
    for key in updates.keys {
        snapshot[key] = defaults.object(forKey: key)
    }
    for (key, value) in updates {
        if let value {
            defaults.set(value, forKey: key)
        } else {
            defaults.removeObject(forKey: key)
        }
    }
    defer {
        for (key, value) in snapshot {
            if let value {
                defaults.set(value, forKey: key)
            } else {
                defaults.removeObject(forKey: key)
            }
        }
    }
    return try body()
}

@Suite(.serialized) struct GatewayConnectionControllerTests {
    @Test @MainActor func resolvedDisplayNameSetsDefaultWhenMissing() {
        let defaults = UserDefaults.standard
        let displayKey = "node.displayName"

        withUserDefaults([displayKey: nil, "node.instanceId": "ios-test"]) {
            let appModel = NodeAppModel()
            let controller = GatewayConnectionController(appModel: appModel, startDiscovery: false)

            let resolved = controller._test_resolvedDisplayName(defaults: defaults)
            #expect(!resolved.isEmpty)
            #expect(defaults.string(forKey: displayKey) == resolved)
        }
    }

    @Test @MainActor func currentCapsReflectToggles() {
        withUserDefaults([
            "node.instanceId": "ios-test",
            "node.displayName": "Test Node",
            "camera.enabled": true,
            "location.enabledMode": CoderClawLocationMode.always.rawValue,
            VoiceWakePreferences.enabledKey: true,
        ]) {
            let appModel = NodeAppModel()
            let controller = GatewayConnectionController(appModel: appModel, startDiscovery: false)
            let caps = Set(controller._test_currentCaps())

            #expect(caps.contains(CoderClawCapability.canvas.rawValue))
            #expect(caps.contains(CoderClawCapability.screen.rawValue))
            #expect(caps.contains(CoderClawCapability.camera.rawValue))
            #expect(caps.contains(CoderClawCapability.location.rawValue))
            #expect(caps.contains(CoderClawCapability.voiceWake.rawValue))
        }
    }

    @Test @MainActor func currentCommandsIncludeLocationWhenEnabled() {
        withUserDefaults([
            "node.instanceId": "ios-test",
            "location.enabledMode": CoderClawLocationMode.whileUsing.rawValue,
        ]) {
            let appModel = NodeAppModel()
            let controller = GatewayConnectionController(appModel: appModel, startDiscovery: false)
            let commands = Set(controller._test_currentCommands())

            #expect(commands.contains(CoderClawLocationCommand.get.rawValue))
        }
    }
    @Test @MainActor func currentCommandsExcludeDangerousSystemExecCommands() {
        withUserDefaults([
            "node.instanceId": "ios-test",
            "camera.enabled": true,
            "location.enabledMode": CoderClawLocationMode.whileUsing.rawValue,
        ]) {
            let appModel = NodeAppModel()
            let controller = GatewayConnectionController(appModel: appModel, startDiscovery: false)
            let commands = Set(controller._test_currentCommands())

            // iOS should expose notify, but not host shell/exec-approval commands.
            #expect(commands.contains(CoderClawSystemCommand.notify.rawValue))
            #expect(!commands.contains(CoderClawSystemCommand.run.rawValue))
            #expect(!commands.contains(CoderClawSystemCommand.which.rawValue))
            #expect(!commands.contains(CoderClawSystemCommand.execApprovalsGet.rawValue))
            #expect(!commands.contains(CoderClawSystemCommand.execApprovalsSet.rawValue))
        }
    }

    @Test @MainActor func loadLastConnectionReadsSavedValues() {
        withUserDefaults([:]) {
            GatewaySettingsStore.saveLastGatewayConnectionManual(
                host: "gateway.example.com",
                port: 443,
                useTLS: true,
                stableID: "manual|gateway.example.com|443")
            let loaded = GatewaySettingsStore.loadLastGatewayConnection()
            #expect(loaded == .manual(host: "gateway.example.com", port: 443, useTLS: true, stableID: "manual|gateway.example.com|443"))
        }
    }

    @Test @MainActor func loadLastConnectionReturnsNilForInvalidData() {
        withUserDefaults([
            "gateway.last.kind": "manual",
            "gateway.last.host": "",
            "gateway.last.port": 0,
            "gateway.last.tls": false,
            "gateway.last.stableID": "manual|invalid|0",
        ]) {
            let loaded = GatewaySettingsStore.loadLastGatewayConnection()
            #expect(loaded == nil)
        }
    }
}
