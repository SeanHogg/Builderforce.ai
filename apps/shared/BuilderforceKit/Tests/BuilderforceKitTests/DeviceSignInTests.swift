import Foundation
import Testing
@testable import BuilderforceKit

@Suite struct DeviceSignInTests {
    private static let code = DeviceCode(
        deviceCode: "dev-1",
        userCode: "WXYZ-1234",
        verificationURI: "https://builderforce.ai/activate",
        verificationURIComplete: "https://builderforce.ai/activate?code=WXYZ-1234&client=ios",
        interval: 5,
        expiresIn: 60)

    private static func response(_ status: Int, _ body: String = "") -> CloudHTTPResponse {
        CloudHTTPResponse(status: status, contentType: "application/json", body: Data(body.utf8))
    }

    @Test func decodesTheCodePairWithDefaults() throws {
        let code = try JSONDecoder().decode(DeviceCode.self, from: Data(#"""
        {"device_code":"d","user_code":"U-1","verification_uri":"https://builderforce.ai/activate"}
        """#.utf8))
        #expect(code.interval == 5)
        #expect(code.expiresIn == 600)
        #expect(code.openURL?.absoluteString == "https://builderforce.ai/activate")
    }

    @Test func classifiesEachPollAnswer() throws {
        #expect(try DevicePollOutcome.classify(Self.response(200, #"{"access_key":"bfk_1","tenant_id":4}"#))
            == .approved(key: "bfk_1", tenantID: 4))
        #expect(try DevicePollOutcome.classify(Self.response(428)) == .pending)
        #expect(try DevicePollOutcome.classify(Self.response(429)) == .slowDown)
        #expect(try DevicePollOutcome.classify(Self.response(403)) == .denied)
        #expect(try DevicePollOutcome.classify(Self.response(410)) == .expired)
        #expect(throws: CloudError.self) {
            try DevicePollOutcome.classify(Self.response(500, #"{"error":"boom"}"#))
        }
    }

    @Test func pendingWaitsTheIntervalAndSlowDownAddsFiveSeconds() {
        let start = Date(timeIntervalSince1970: 1000)
        var schedule = DevicePollSchedule(code: Self.code, startedAt: start)
        #expect(schedule.next(after: .pending, now: start.addingTimeInterval(5)) == .wait(seconds: 5))
        #expect(schedule.next(after: .slowDown, now: start.addingTimeInterval(10)) == .wait(seconds: 10))
        #expect(schedule.next(after: .pending, now: start.addingTimeInterval(20)) == .wait(seconds: 10))
    }

    @Test func approvalDenialAndExpiryEndTheLoop() {
        let start = Date(timeIntervalSince1970: 1000)
        var schedule = DevicePollSchedule(code: Self.code, startedAt: start)
        #expect(schedule.next(after: .approved(key: "bfk_2", tenantID: 9), now: start)
            == .approved(key: "bfk_2", tenantID: 9))
        #expect(schedule.next(after: .denied, now: start) == .failed(.denied))
        #expect(schedule.next(after: .expired, now: start) == .failed(.expired))
        // A wait that would run past the code's lifetime ends as expired.
        #expect(schedule.next(after: .pending, now: start.addingTimeInterval(58)) == .failed(.expired))
    }
}
