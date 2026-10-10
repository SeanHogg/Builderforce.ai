// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "CoderClawKit",
    platforms: [
        .iOS(.v18),
        .macOS(.v15),
    ],
    products: [
        .library(name: "CoderClawProtocol", targets: ["CoderClawProtocol"]),
        .library(name: "CoderClawKit", targets: ["CoderClawKit"]),
        .library(name: "CoderClawChatUI", targets: ["CoderClawChatUI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/steipete/ElevenLabsKit", exact: "0.1.0"),
        .package(url: "https://github.com/gonzalezreal/textual", exact: "0.3.1"),
    ],
    targets: [
        .target(
            name: "CoderClawProtocol",
            path: "Sources/CoderClawProtocol",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "CoderClawKit",
            dependencies: [
                "CoderClawProtocol",
                .product(name: "ElevenLabsKit", package: "ElevenLabsKit"),
            ],
            path: "Sources/CoderClawKit",
            resources: [
                .process("Resources"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "CoderClawChatUI",
            dependencies: [
                "CoderClawKit",
                .product(
                    name: "Textual",
                    package: "textual",
                    condition: .when(platforms: [.macOS, .iOS])),
            ],
            path: "Sources/CoderClawChatUI",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "CoderClawKitTests",
            dependencies: ["CoderClawKit", "CoderClawChatUI"],
            path: "Tests/CoderClawKitTests",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])
