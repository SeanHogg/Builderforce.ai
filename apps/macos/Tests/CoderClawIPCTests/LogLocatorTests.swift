import Darwin
import Foundation
import Testing
@testable import CoderClaw

@Suite struct LogLocatorTests {
    @Test func launchdGatewayLogPathEnsuresTmpDirExists() throws {
        let fm = FileManager()
        let baseDir = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
        let logDir = baseDir.appendingPathComponent("coderclaw-tests-\(UUID().uuidString)")

        setenv("CODERCLAW_LOG_DIR", logDir.path, 1)
        defer {
            unsetenv("CODERCLAW_LOG_DIR")
            try? fm.removeItem(at: logDir)
        }

        _ = LogLocator.launchdGatewayLogPath

        var isDir: ObjCBool = false
        #expect(fm.fileExists(atPath: logDir.path, isDirectory: &isDir))
        #expect(isDir.boolValue == true)
    }
}
