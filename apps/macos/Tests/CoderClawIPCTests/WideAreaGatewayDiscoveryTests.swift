import Darwin
import Testing
@testable import CoderClawDiscovery

@Suite
struct WideAreaGatewayDiscoveryTests {
    @Test func discoversBeaconFromTailnetDnsSdFallback() {
        setenv("CODERCLAW_WIDE_AREA_DOMAIN", "coderclaw.internal", 1)
        let statusJson = """
        {
          "Self": { "TailscaleIPs": ["100.69.232.64"] },
          "Peer": {
            "peer-1": { "TailscaleIPs": ["100.123.224.76"] }
          }
        }
        """

        let context = WideAreaGatewayDiscovery.DiscoveryContext(
            tailscaleStatus: { statusJson },
            dig: { args, _ in
                let recordType = args.last ?? ""
                let nameserver = args.first(where: { $0.hasPrefix("@") }) ?? ""
                if recordType == "PTR" {
                    if nameserver == "@100.123.224.76" {
                        return "steipetacstudio-gateway._coderclaw-gw._tcp.coderclaw.internal.\n"
                    }
                    return ""
                }
                if recordType == "SRV" {
                    return "0 0 18789 steipetacstudio.coderclaw.internal."
                }
                if recordType == "TXT" {
                    return "\"displayName=Peter\\226\\128\\153s Mac Studio (CoderClaw)\" \"gatewayPort=18789\" \"tailnetDns=peters-mac-studio-1.sheep-coho.ts.net\" \"cliPath=/Users/steipete/coderclaw/src/entry.ts\""
                }
                return ""
            })

        let beacons = WideAreaGatewayDiscovery.discover(
            timeoutSeconds: 2.0,
            context: context)

        #expect(beacons.count == 1)
        let beacon = beacons[0]
        let expectedDisplay = "Peter\u{2019}s Mac Studio (CoderClaw)"
        #expect(beacon.displayName == expectedDisplay)
        #expect(beacon.port == 18789)
        #expect(beacon.gatewayPort == 18789)
        #expect(beacon.tailnetDns == "peters-mac-studio-1.sheep-coho.ts.net")
        #expect(beacon.cliPath == "/Users/steipete/coderclaw/src/entry.ts")
    }

    @Test func discoversCurrentGatewayServiceType() {
        setenv("CODERCLAW_WIDE_AREA_DOMAIN", "coderclaw.internal", 1)
        let statusJson = """
        { "Self": { "TailscaleIPs": ["100.69.232.64"] } }
        """

        let context = WideAreaGatewayDiscovery.DiscoveryContext(
            tailscaleStatus: { statusJson },
            dig: { args, _ in
                let recordType = args.last ?? ""
                if recordType == "PTR" {
                    // Only the current service type answers; the legacy type has no records.
                    if args.contains("_builderforce-gw._tcp.coderclaw.internal") {
                        return "studio-gateway._builderforce-gw._tcp.coderclaw.internal.\n"
                    }
                    return ""
                }
                if recordType == "SRV" {
                    return "0 0 18789 studio.coderclaw.internal."
                }
                if recordType == "TXT" {
                    return "\"displayName=Studio\" \"gatewayPort=18789\""
                }
                return ""
            })

        let beacons = WideAreaGatewayDiscovery.discover(
            timeoutSeconds: 2.0,
            context: context)

        #expect(beacons.count == 1)
        #expect(beacons.first?.instanceName == "studio-gateway")
        #expect(beacons.first?.displayName == "Studio")
        #expect(beacons.first?.port == 18789)
    }

    @Test func stripsEitherGatewayServiceTypeFromPTR() {
        #expect(WideAreaGatewayDiscovery.instanceName(
            fromPTR: "gw._builderforce-gw._tcp.example.internal",
            domainTrimmed: "example.internal") == "gw")
        #expect(WideAreaGatewayDiscovery.instanceName(
            fromPTR: "gw._coderclaw-gw._tcp.example.internal",
            domainTrimmed: "example.internal") == "gw")
        #expect(WideAreaGatewayDiscovery.probeNames(domainTrimmed: "example.internal") == [
            "_builderforce-gw._tcp.example.internal",
            "_coderclaw-gw._tcp.example.internal",
        ])
    }
}
