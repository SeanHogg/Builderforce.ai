import BuilderforceKit
import Testing

@Suite struct BonjourTypesTests {
    @Test func browsesTheBuilderforceGatewayServiceType() {
        #expect(BuilderforceBonjour.gatewayServiceTypes == ["_builderforce-gw._tcp"])
    }

    @Test func browseTargetsCoverEveryServiceTypeInEveryDomain() {
        let targets = BuilderforceBonjour.gatewayBrowseTargets
        let expectedCount = BuilderforceBonjour.gatewayServiceTypes.count * BuilderforceBonjour.gatewayServiceDomains.count
        #expect(targets.count == expectedCount)
        for serviceType in BuilderforceBonjour.gatewayServiceTypes {
            #expect(targets.contains { $0.serviceType == serviceType && $0.domain == "local." })
        }
        #expect(Set(targets.map(\.key)).count == targets.count)
    }

    @Test func browseTargetKeyJoinsTypeAndDomain() {
        let target = BuilderforceBonjour.gatewayBrowseTargets.first { $0.domain == "local." }
        #expect(target?.key == "_builderforce-gw._tcp|local.")
    }
}
