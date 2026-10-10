import AppKit
import BuilderforceChatUI
import BuilderforceKit
import Foundation
import Testing
@testable import Builderforce

@Suite(.serialized)
@MainActor
struct WebChatSwiftUISmokeTests {
    /// A signed-out cloud: the window renders the sign-in view without a network.
    private struct SignedOutTransport: BuilderforceChatTransport {
        func isSignedIn() async -> Bool { false }
        func startSignIn() async throws -> DeviceCode { throw CloudError.signedOut }
        func finishSignIn(_: DeviceCode) async throws { throw CloudError.signedOut }
        func signOut() async {}
        func listChats() async throws -> [BrainChat] { [] }
        func createChat(title _: String?) async throws -> BrainChat { BrainChat(id: 1, title: nil) }
        func messages(chatID _: Int) async throws -> [BrainChatMessage] { [] }
        func agents(chatID _: Int) async throws -> [BrainChatAgent] { [] }

        func upload(_: BuilderforceChatUpload) async throws -> (attachment: BrainChatAttachment, url: String) {
            throw CloudError.signedOut
        }

        func send(chatID _: Int, content _: String, to _: BrainChatAgent?, attachments _: [BrainChatAttachment]) async throws {}

        func reply(
            chatID _: Int,
            imageURLs _: [String],
            approve _: @escaping @Sendable (BrainToolApproval) async -> Bool,
            onEvent _: @escaping @Sendable (BrainReplyEvent) async -> Void) async throws {}
    }

    @Test func windowControllerShowAndClose() {
        let controller = WebChatSwiftUIWindowController(
            presentation: .window,
            transport: SignedOutTransport())
        controller.show()
        controller.close()
    }

    @Test func panelControllerPresentAndClose() {
        let anchor = { NSRect(x: 200, y: 400, width: 40, height: 40) }
        let controller = WebChatSwiftUIWindowController(
            presentation: .panel(anchorProvider: anchor),
            transport: SignedOutTransport())
        controller.presentAnchored(anchorProvider: anchor)
        controller.close()
    }
}
