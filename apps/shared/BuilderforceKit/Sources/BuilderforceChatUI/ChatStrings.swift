import BuilderforceKit
import Foundation

/// Every user-visible string of the cloud chat, from the package's string catalog
/// (`Resources/Localizable.xcstrings`: en, de, es, fr, zh-Hans). The keys are stable and
/// the same on iOS and macOS — the apps use these rather than keeping their own copies.
public enum ChatStrings {
    // MARK: - Chat

    public static var title: String { text("chat.title", "Chat") }
    public static var windowTitle: String { text("chat.windowTitle", "Builderforce Chat") }
    public static var close: String { text("chat.close", "Close") }
    public static var chats: String { text("chat.header.chats", "Chats") }
    public static var newChat: String { text("chat.header.newChat", "New chat") }
    public static var untitledChat: String { text("chat.header.untitled", "Untitled chat") }
    public static var signOut: String { text("chat.header.signOut", "Sign out") }
    public static var emptyTitle: String { text("chat.empty.title", "Ask the Brain") }
    public static var emptyMessage: String {
        text("chat.empty.message", "Ask about your projects, tickets and plans — or send a message to an assigned agent.")
    }

    public static var thinking: String { text("chat.thinking", "The Brain is thinking…") }
    public static var working: String { text("chat.working", "Working…") }

    // MARK: - Composer

    public static var placeholder: String { text("chat.composer.placeholder", "Message the Brain…") }
    public static var addAttachment: String { text("chat.composer.add", "Add attachment") }
    public static var chooseImages: String { text("chat.composer.chooseFiles", "Choose attachments") }
    public static var removeAttachment: String { text("chat.composer.removeAttachment", "Remove attachment") }
    public static var send: String { text("chat.composer.send", "Send") }
    public static var stop: String { text("chat.composer.stop", "Stop") }
    public static var dictate: String { text("chat.composer.dictate", "Dictate") }
    public static var stopDictation: String { text("chat.composer.stopDictation", "Stop dictation") }
    public static var brain: String { text("chat.composer.brain", "The Brain") }
    public static var queuedHint: String { text("chat.composer.queued", "Sends after this reply") }
    public static var removeQueued: String { text("chat.composer.removeQueued", "Remove queued message") }

    public static func to(_ name: String) -> String {
        String(localized: "chat.composer.to", defaultValue: "To \(name)", bundle: self.bundle)
    }

    /// Three short starters shown above an empty chat.
    public static var suggestions: [String] {
        [
            text("chat.suggestion.board", "What's on my board today?"),
            text("chat.suggestion.tickets", "Summarize my open tickets"),
            text("chat.suggestion.plan", "Plan my next sprint"),
        ]
    }

    // MARK: - Sign in

    public static var signInTitle: String { text("chat.signIn.title", "Sign in to Builderforce") }
    public static var signInMessage: String {
        text("chat.signIn.message", "Chat with the Brain and your workspace's agents. You sign in with your Builderforce account in the browser.")
    }

    public static var signInButton: String { text("chat.signIn.button", "Sign in") }
    public static var signInCodePrompt: String { text("chat.signIn.codePrompt", "Confirm this code in your browser:") }
    public static var signInOpen: String { text("chat.signIn.open", "Open sign-in page") }
    public static var signInWaiting: String { text("chat.signIn.waiting", "Waiting for approval…") }
    public static var signInCancel: String { text("chat.signIn.cancel", "Cancel") }
    public static var signInStarting: String { text("chat.signIn.starting", "Getting a sign-in code…") }

    // MARK: - Approvals

    public static func approvalTitle(_ action: String) -> String {
        String(localized: "chat.approval.title", defaultValue: "The Brain wants to run “\(action)”", bundle: self.bundle)
    }

    public static var approve: String { text("chat.approval.approve", "Approve") }
    public static var decline: String { text("chat.approval.decline", "Decline") }

    // MARK: - Notices

    public static var refresh: String { text("chat.notice.refresh", "Refresh") }

    // MARK: - Dictation

    public static var dictationUnavailable: String {
        text("chat.dictation.unavailable", "Dictation isn't available on this device.")
    }

    public static var dictationDenied: String {
        text("chat.dictation.denied", "Allow microphone and speech recognition access in Settings to dictate.")
    }

    // MARK: - Onboarding (macOS)

    public static var onboardingTitle: String { text("chat.onboarding.title", "Meet the Brain") }
    public static var onboardingMessage: String {
        text("chat.onboarding.message", "Sign in to Builderforce to chat with the Brain about your projects and hand work to your agents.")
    }

    // MARK: - Errors

    public static func agentNoReply(_ name: String) -> String {
        String(
            localized: "chat.error.agentNoReply",
            defaultValue: "\(name) hasn't replied yet. The answer appears here when it arrives.",
            bundle: self.bundle)
    }

    public static func attachmentTooLarge(_ fileName: String) -> String {
        String(localized: "chat.error.attachmentTooLarge", defaultValue: "\(fileName) is larger than 5 MB.", bundle: self.bundle)
    }

    public static func serverError(_ message: String) -> String {
        String(localized: "chat.error.server", defaultValue: "Builderforce answered with an error: \(message)", bundle: self.bundle)
    }

    /// An error as a person reads it.
    public static func describe(_ error: any Error) -> String {
        switch error {
        case let cloud as CloudError:
            switch cloud {
            case .signedOut:
                return text("chat.error.signedOut", "Sign in to Builderforce to chat.")
            case .keyRejected:
                return text("chat.error.keyRejected", "Builderforce no longer accepts this sign-in. Sign in again.")
            case .unreachable:
                return text("chat.error.unreachable", "Builderforce could not be reached. Check your connection.")
            case let .status(_, message, _):
                return self.serverError(message)
            case .invalidResponse:
                return text("chat.error.invalid", "Builderforce sent an answer this app could not read.")
            }
        case let failure as DeviceSignInFailure:
            switch failure {
            case .denied:
                return text("chat.error.signInDenied", "Sign-in was declined.")
            case .expired:
                return text("chat.error.signInExpired", "The sign-in code expired. Try again.")
            }
        default:
            return error.localizedDescription
        }
    }

    /// The ChatUI resource bundle (the string catalog). A packaged app without it falls
    /// back to the main bundle, where each string reads in English (its default value).
    private static let bundle: Bundle =
        BuilderforceKitResources.packageBundle(named: "BuilderforceKit_BuilderforceChatUI") ?? .main

    private static func text(_ key: StaticString, _ value: String.LocalizationValue) -> String {
        String(localized: key, defaultValue: value, bundle: self.bundle)
    }
}
