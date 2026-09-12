import CoderClawKit
import Testing

@Suite struct BonjourTypesTests {
    @Test func browsesCurrentGatewayServiceTypeFirstAndKeepsLegacyType() {
        #expect(CoderClawBonjour.gatewayServiceTypes == ["_builderforce-gw._tcp", "_coderclaw-gw._tcp"])
    }

    @Test func browseTargetsCoverEveryServiceTypeInEveryDomain() {
        let targets = CoderClawBonjour.gatewayBrowseTargets
        let expectedCount = CoderClawBonjour.gatewayServiceTypes.count * CoderClawBonjour.gatewayServiceDomains.count
        #expect(targets.count == expectedCount)
        for serviceType in CoderClawBonjour.gatewayServiceTypes {
            #expect(targets.contains { $0.serviceType == serviceType && $0.domain == "local." })
        }
        #expect(Set(targets.map(\.key)).count == targets.count)
    }

    @Test func browseTargetKeyJoinsTypeAndDomain() {
        let target = CoderClawBonjour.gatewayBrowseTargets.first { $0.domain == "local." }
        #expect(target?.key == "_builderforce-gw._tcp|local.")
    }
}
