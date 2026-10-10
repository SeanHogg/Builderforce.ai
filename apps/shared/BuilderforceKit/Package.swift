// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "BuilderforceKit",
    platforms: [
        .iOS(.v18),
        .macOS(.v15),
    ],
    products: [
        .library(name: "BuilderforceProtocol", targets: ["BuilderforceProtocol"]),
        .library(name: "BuilderforceKit", targets: ["BuilderforceKit"]),
        .library(name: "BuilderforceChatUI", targets: ["BuilderforceChatUI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/steipete/ElevenLabsKit", exact: "0.1.0"),
        .package(url: "https://github.com/gonzalezreal/textual", exact: "0.3.1"),
    ],
    targets: [
        .target(
            name: "BuilderforceProtocol",
            path: "Sources/BuilderforceProtocol",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "BuilderforceKit",
            dependencies: [
                "BuilderforceProtocol",
                .product(name: "ElevenLabsKit", package: "ElevenLabsKit"),
            ],
            path: "Sources/BuilderforceKit",
            resources: [
                .process("Resources"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "BuilderforceChatUI",
            dependencies: [
                "BuilderforceKit",
                .product(
                    name: "Textual",
                    package: "textual",
                    condition: .when(platforms: [.macOS, .iOS])),
            ],
            path: "Sources/BuilderforceChatUI",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "BuilderforceKitTests",
            dependencies: ["BuilderforceKit", "BuilderforceChatUI"],
            path: "Tests/BuilderforceKitTests",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])
