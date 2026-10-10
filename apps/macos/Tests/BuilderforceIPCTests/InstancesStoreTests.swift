import BuilderforceProtocol
import Testing
@testable import Builderforce

@Suite struct InstancesStoreTests {
    @Test
    @MainActor
    func presenceEventPayloadDecodesViaJSONEncoder() {
        // Build a payload that mirrors the gateway's presence event shape:
        // { "presence": [ PresenceEntry ] }
        let entry: [String: BuilderforceProtocol.AnyCodable] = [
            "host": .init("gw"),
            "ip": .init("10.0.0.1"),
            "version": .init("2.0.0"),
            "mode": .init("gateway"),
            "lastInputSeconds": .init(5),
            "reason": .init("test"),
            "text": .init("Gateway node"),
            "ts": .init(1_730_000_000),
        ]
        let payloadMap: [String: BuilderforceProtocol.AnyCodable] = [
            "presence": .init([BuilderforceProtocol.AnyCodable(entry)]),
        ]
        let payload = BuilderforceProtocol.AnyCodable(payloadMap)

        let store = InstancesStore(isPreview: true)
        store.handlePresenceEventPayload(payload)

        #expect(store.instances.count == 1)
        let instance = store.instances.first
        #expect(instance?.host == "gw")
        #expect(instance?.ip == "10.0.0.1")
        #expect(instance?.mode == "gateway")
        #expect(instance?.reason == "test")
    }
}
