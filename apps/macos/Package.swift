// swift-tools-version: 6.2
// Package manifest for the CoderClaw macOS companion (menu bar app + IPC library).

import PackageDescription

let package = Package(
    name: "CoderClaw",
    platforms: [
        .macOS(.v15),
    ],
    products: [
        .library(name: "CoderClawIPC", targets: ["CoderClawIPC"]),
        .library(name: "CoderClawDiscovery", targets: ["CoderClawDiscovery"]),
        .executable(name: "CoderClaw", targets: ["CoderClaw"]),
        .executable(name: "coderclaw-mac", targets: ["CoderClawMacCLI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/orchetect/MenuBarExtraAccess", exact: "1.2.2"),
        .package(url: "https://github.com/swiftlang/swift-subprocess.git", from: "0.1.0"),
        .package(url: "https://github.com/apple/swift-log.git", from: "1.8.0"),
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.8.1"),
        .package(url: "https://github.com/steipete/Peekaboo.git", branch: "main"),
        .package(path: "../shared/CoderClawKit"),
        .package(path: "../../Swabble"),
    ],
    targets: [
        .target(
            name: "CoderClawIPC",
            dependencies: [],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "CoderClawDiscovery",
            dependencies: [
                .product(name: "CoderClawKit", package: "CoderClawKit"),
            ],
            path: "Sources/CoderClawDiscovery",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "CoderClaw",
            dependencies: [
                "CoderClawIPC",
                "CoderClawDiscovery",
                .product(name: "CoderClawKit", package: "CoderClawKit"),
                .product(name: "CoderClawChatUI", package: "CoderClawKit"),
                .product(name: "CoderClawProtocol", package: "CoderClawKit"),
                .product(name: "SwabbleKit", package: "swabble"),
                .product(name: "MenuBarExtraAccess", package: "MenuBarExtraAccess"),
                .product(name: "Subprocess", package: "swift-subprocess"),
                .product(name: "Logging", package: "swift-log"),
                .product(name: "Sparkle", package: "Sparkle"),
                .product(name: "PeekabooBridge", package: "Peekaboo"),
                .product(name: "PeekabooAutomationKit", package: "Peekaboo"),
            ],
            exclude: [
                "Resources/Info.plist",
            ],
            resources: [
                .copy("Resources/CoderClaw.icns"),
                .copy("Resources/DeviceModels"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "CoderClawMacCLI",
            dependencies: [
                "CoderClawDiscovery",
                .product(name: "CoderClawKit", package: "CoderClawKit"),
                .product(name: "CoderClawProtocol", package: "CoderClawKit"),
            ],
            path: "Sources/CoderClawMacCLI",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "CoderClawIPCTests",
            dependencies: [
                "CoderClawIPC",
                "CoderClaw",
                "CoderClawDiscovery",
                .product(name: "CoderClawProtocol", package: "CoderClawKit"),
                .product(name: "SwabbleKit", package: "swabble"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])
