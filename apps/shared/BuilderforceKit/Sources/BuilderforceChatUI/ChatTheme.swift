import SwiftUI

#if os(macOS)
import AppKit
#else
import UIKit
#endif

#if os(macOS)
extension NSAppearance {
    fileprivate var isDarkAqua: Bool {
        self.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
    }
}
#endif

enum BuilderforceChatTheme {
    #if os(macOS)
    static func resolvedAssistantBubbleColor(for appearance: NSAppearance) -> NSColor {
        // NSColor semantic colors don't reliably resolve for arbitrary NSAppearance in SwiftPM.
        // Use explicit light/dark values so the bubble updates when the system appearance flips.
        appearance.isDarkAqua
            ? NSColor(calibratedWhite: 0.18, alpha: 0.88)
            : NSColor(calibratedWhite: 0.94, alpha: 0.92)
    }

    static func resolvedOnboardingAssistantBubbleColor(for appearance: NSAppearance) -> NSColor {
        appearance.isDarkAqua
            ? NSColor(calibratedWhite: 0.20, alpha: 0.94)
            : NSColor(calibratedWhite: 0.97, alpha: 0.98)
    }

    static let assistantBubbleDynamicNSColor = NSColor(
        name: NSColor.Name("BuilderforceChatTheme.assistantBubble"),
        dynamicProvider: resolvedAssistantBubbleColor(for:))

    static let onboardingAssistantBubbleDynamicNSColor = NSColor(
        name: NSColor.Name("BuilderforceChatTheme.onboardingAssistantBubble"),
        dynamicProvider: resolvedOnboardingAssistantBubbleColor(for:))
    #endif

    @ViewBuilder
    static var background: some View {
        #if os(macOS)
        ZStack {
            Rectangle()
                .fill(.ultraThinMaterial)
            LinearGradient(
                colors: [
                    Color.white.opacity(0.12),
                    Color(nsColor: .windowBackgroundColor).opacity(0.35),
                    Color.black.opacity(0.35),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing)
            RadialGradient(
                colors: [
                    Color(nsColor: .systemOrange).opacity(0.14),
                    .clear,
                ],
                center: .topLeading,
                startRadius: 40,
                endRadius: 320)
            RadialGradient(
                colors: [
                    Color(nsColor: .systemTeal).opacity(0.12),
                    .clear,
                ],
                center: .topTrailing,
                startRadius: 40,
                endRadius: 280)
            Color.black.opacity(0.08)
        }
        #else
        Color(uiColor: .systemBackground)
        #endif
    }

    static var subtleCard: AnyShapeStyle {
        #if os(macOS)
        AnyShapeStyle(.ultraThinMaterial)
        #else
        AnyShapeStyle(Color(uiColor: .secondarySystemBackground).opacity(0.9))
        #endif
    }

    static var userBubble: Color {
        .accentColor
    }

    static var assistantBubble: Color {
        #if os(macOS)
        Color(nsColor: self.assistantBubbleDynamicNSColor)
        #else
        Color(uiColor: .secondarySystemBackground)
        #endif
    }

    static var onboardingAssistantBubble: Color {
        #if os(macOS)
        Color(nsColor: self.onboardingAssistantBubbleDynamicNSColor)
        #else
        Color(uiColor: .secondarySystemBackground)
        #endif
    }

    static var onboardingAssistantBorder: Color {
        #if os(macOS)
        Color.white.opacity(0.12)
        #else
        Color.white.opacity(0.12)
        #endif
    }

    static var userText: Color { .white }

    static var assistantText: Color {
        #if os(macOS)
        Color(nsColor: .labelColor)
        #else
        Color(uiColor: .label)
        #endif
    }

    /// The one-box composer's fill (and its chips'): the system's secondary fill, which
    /// reads correctly in light and dark.
    static var composerFill: AnyShapeStyle {
        #if os(macOS)
        AnyShapeStyle(.quaternary)
        #else
        AnyShapeStyle(Color(uiColor: .secondarySystemFill))
        #endif
    }
}

enum BuilderforcePlatformImageFactory {
    static func image(_ image: BuilderforcePlatformImage) -> Image {
        #if os(macOS)
        Image(nsImage: image)
        #else
        Image(uiImage: image)
        #endif
    }
}
