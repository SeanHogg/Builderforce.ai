// swift-tools-version: 6.2
// Package manifest for the Builderforce macOS companion (menu bar app + IPC library).

import PackageDescription

let package = Package(
    name: "Builderforce",
    platforms: [
        .macOS(.v15),
    ],
    products: [
        .library(name: "BuilderforceIPC", targets: ["BuilderforceIPC"]),
        .library(name: "BuilderforceDiscovery", targets: ["BuilderforceDiscovery"]),
        .executable(name: "Builderforce", targets: ["Builderforce"]),
        .executable(name: "builderforce-mac", targets: ["BuilderforceMacCLI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/orchetect/MenuBarExtraAccess", exact: "1.2.2"),
        .package(url: "https://github.com/swiftlang/swift-subprocess.git", from: "0.1.0"),
        .package(url: "https://github.com/apple/swift-log.git", from: "1.8.0"),
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.8.1"),
        .package(url: "https://github.com/steipete/Peekaboo.git", branch: "main"),
        .package(path: "../shared/BuilderforceKit"),
        .package(path: "../../agent-runtime/Swabble"),
    ],
    targets: [
        .target(
            name: "BuilderforceIPC",
            dependencies: [],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "BuilderforceDiscovery",
            dependencies: [
                .product(name: "BuilderforceKit", package: "BuilderforceKit"),
            ],
            path: "Sources/BuilderforceDiscovery",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "Builderforce",
            dependencies: [
                "BuilderforceIPC",
                "BuilderforceDiscovery",
                .product(name: "BuilderforceKit", package: "BuilderforceKit"),
                .product(name: "BuilderforceChatUI", package: "BuilderforceKit"),
                .product(name: "BuilderforceProtocol", package: "BuilderforceKit"),
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
                .copy("Resources/Builderforce.icns"),
                .copy("Resources/DeviceModels"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "BuilderforceMacCLI",
            dependencies: [
                "BuilderforceDiscovery",
                .product(name: "BuilderforceKit", package: "BuilderforceKit"),
                .product(name: "BuilderforceProtocol", package: "BuilderforceKit"),
            ],
            path: "Sources/BuilderforceMacCLI",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "BuilderforceIPCTests",
            dependencies: [
                "BuilderforceIPC",
                "Builderforce",
                "BuilderforceDiscovery",
                .product(name: "BuilderforceProtocol", package: "BuilderforceKit"),
                .product(name: "SwabbleKit", package: "swabble"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])
