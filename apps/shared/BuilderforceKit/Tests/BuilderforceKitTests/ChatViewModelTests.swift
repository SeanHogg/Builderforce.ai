import BuilderforceKit
import Foundation
import Testing
@testable import BuilderforceChatUI

private struct TimeoutError: Error, CustomStringConvertible {
    let label: String
    var description: String { "Timeout waiting for: \(self.label)" }
}

private func waitUntil(
    _ label: String,
    timeoutSeconds: Double = 3.0,
    pollMs: UInt64 = 10,
    _ condition: @escaping @Sendable () async -> Bool) async throws
{
    let deadline = Date().addingTimeInterval(timeoutSeconds)
    while Date() < deadline {
        if await condition() {
            return
        }
        try await Task.sleep(nanoseconds: pollMs * 1_000_000)
    }
    throw TimeoutError(label: label)
}

/// The cloud as the view model sees it, in memory: one chat whose transcript grows as
/// turns are sent and the Brain replies.
private actor FakeCloud {
    var signedIn: Bool
    var chats: [BrainChat]
    var stored: [Int: [BrainChatMessage]]
    var agents: [BrainChatAgent]
    var sent: [(content: String, to: String?)] = []
    var replyDelay: UInt64 = 50_000_000
    private var nextID = 100

    init(signedIn: Bool, chats: [BrainChat] = [], stored: [Int: [BrainChatMessage]] = [:], agents: [BrainChatAgent] = []) {
        self.signedIn = signedIn
        self.chats = chats
        self.stored = stored
        self.agents = agents
    }

    func append(chatID: Int, role: String, content: String) {
        self.nextID += 1
        self.stored[chatID, default: []].append(
            BrainChatMessage(id: self.nextID, role: role, content: content, seq: self.nextID))
    }

    func record(content: String, to: String?) {
        self.sent.append((content, to))
    }

    func sentContents() -> [String] {
        self.sent.map(\.content)
    }
}

private struct FakeTransport: BuilderforceChatTransport {
    let cloud: FakeCloud

    func isSignedIn() async -> Bool { await self.cloud.signedIn }
    func startSignIn() async throws -> DeviceCode {
        DeviceCode(deviceCode: "dev", userCode: "ABCD-EFGH", verificationURI: "https://example.test/activate", verificationURIComplete: "https://example.test/activate?code=ABCD-EFGH")
    }

    func finishSignIn(_: DeviceCode) async throws { await self.cloud.setSignedIn() }
    func signOut() async {}
    func listChats() async throws -> [BrainChat] { await self.cloud.chats }
    func createChat(title: String?) async throws -> BrainChat { BrainChat(id: 99, title: title) }
    func messages(chatID: Int) async throws -> [BrainChatMessage] { await self.cloud.stored[chatID] ?? [] }
    func agents(chatID _: Int) async throws -> [BrainChatAgent] { await self.cloud.agents }

    func upload(_ upload: BuilderforceChatUpload) async throws -> (attachment: BrainChatAttachment, url: String) {
        (BrainChatAttachment(key: "k/\(upload.fileName)", name: upload.fileName, type: upload.mimeType), "https://example.test/u")
    }

    func send(chatID: Int, content: String, to agent: BrainChatAgent?, attachments _: [BrainChatAttachment]) async throws {
        await self.cloud.record(content: content, to: agent?.agentRef)
        await self.cloud.append(chatID: chatID, role: "user", content: content)
    }

    func reply(
        chatID: Int,
        imageURLs _: [String],
        approve _: @escaping @Sendable (BrainToolApproval) async -> Bool,
        onEvent: @escaping @Sendable (BrainReplyEvent) async -> Void) async throws
    {
        await onEvent(.draft("Thinking out loud"))
        try await Task.sleep(nanoseconds: self.cloud.replyDelay)
        await self.cloud.append(chatID: chatID, role: "assistant", content: "Done")
    }
}

@Suite struct ChatViewModelTests {
    @Test func signedOutShowsSignIn() async throws {
        let transport = FakeTransport(cloud: FakeCloud(signedIn: false))
        let vm = await MainActor.run { BuilderforceChatViewModel(transport: transport) }
        await MainActor.run { vm.load() }
        try await waitUntil("signed out") { await MainActor.run { vm.authState == .signedOut } }
        await MainActor.run { vm.startSignIn() }
        try await waitUntil("signed in") { await MainActor.run { vm.authState == .signedIn } }
    }

    @Test func loadsChatsAndOpensTheNewest() async throws {
        let cloud = FakeCloud(
            signedIn: true,
            chats: [BrainChat(id: 7, title: "Launch"), BrainChat(id: 3, title: nil)],
            stored: [7: [
                BrainChatMessage(id: 1, role: "user", content: "Plan the launch", seq: 1),
                BrainChatMessage(id: 2, role: "tool", content: "ignored", seq: 2),
                BrainChatMessage(
                    id: 3,
                    role: "assistant",
                    content: "On it",
                    metadata: #"{"authoredBy":{"name":"Ada"}}"#,
                    seq: 3),
            ]],
            agents: [BrainChatAgent(id: "a1", agentRef: "42", name: "Ada")])
        let vm = await MainActor.run { BuilderforceChatViewModel(transport: FakeTransport(cloud: cloud)) }
        await MainActor.run { vm.load() }
        try await waitUntil("transcript") { await MainActor.run { vm.messages.count == 2 } }

        await MainActor.run {
            #expect(vm.activeChatID == 7)
            #expect(vm.chats.count == 2)
            #expect(vm.agents.map(\.name) == ["Ada"])
            #expect(vm.messages[1].plainText == "**Ada**\n\nOn it")
            #expect(vm.messages[0].id == BuilderforceChatViewModel.stableID(1))
        }
    }

    @Test func sendRunsTheBrainAndQueuesFollowUps() async throws {
        let cloud = FakeCloud(signedIn: true, chats: [BrainChat(id: 5, title: "Ops")])
        await cloud.setReplyDelay(300_000_000)
        let vm = await MainActor.run { BuilderforceChatViewModel(transport: FakeTransport(cloud: cloud)) }
        await MainActor.run { vm.load() }
        try await waitUntil("opened") { await MainActor.run { vm.activeChatID == 5 && !vm.isLoading } }

        await MainActor.run {
            vm.input = "What is left?"
            vm.send()
        }
        try await waitUntil("running") { await MainActor.run { vm.isRunning } }
        try await waitUntil("draft") { await MainActor.run { vm.streamingAssistantText == "Thinking out loud" } }

        await MainActor.run {
            vm.input = "And after that?"
            vm.send()
            #expect(vm.queued == ["And after that?"])
            #expect(vm.input.isEmpty)
        }

        try await waitUntil("both sent", timeoutSeconds: 5) { await cloud.sentContents().count == 2 }
        try await waitUntil("idle", timeoutSeconds: 5) { await MainActor.run { !vm.isRunning && vm.queued.isEmpty } }
        #expect(await cloud.sentContents() == ["What is left?", "And after that?"])
        await MainActor.run {
            #expect(vm.streamingAssistantText == nil)
            #expect(vm.messages.map(\.role) == ["user", "assistant", "user", "assistant"])
        }
    }

    @Test func stopEndsTheRunAndDropsQueuedText() async throws {
        let cloud = FakeCloud(signedIn: true, chats: [BrainChat(id: 5, title: nil)])
        await cloud.setReplyDelay(5_000_000_000)
        let vm = await MainActor.run { BuilderforceChatViewModel(transport: FakeTransport(cloud: cloud)) }
        await MainActor.run { vm.load() }
        try await waitUntil("opened") { await MainActor.run { vm.activeChatID == 5 && !vm.isLoading } }
        await MainActor.run {
            vm.input = "Long task"
            vm.send()
        }
        try await waitUntil("running") { await MainActor.run { vm.isRunning } }
        await MainActor.run {
            vm.input = "queued"
            vm.send()
            vm.stop()
            #expect(!vm.isRunning)
            #expect(vm.queued.isEmpty)
        }
    }

    @Test func addressedAgentGetsMetadataNotABrainReply() async throws {
        let agent = BrainChatAgent(id: "a1", agentRef: "42", name: "Ada")
        let cloud = FakeCloud(signedIn: true, chats: [BrainChat(id: 5, title: nil)], agents: [agent])
        let vm = await MainActor.run { BuilderforceChatViewModel(transport: FakeTransport(cloud: cloud)) }
        await MainActor.run { vm.load() }
        try await waitUntil("agents") { await MainActor.run { !vm.agents.isEmpty } }
        await MainActor.run {
            vm.recipient = vm.agents.first
            vm.input = "Take the ticket"
            vm.send()
        }
        try await waitUntil("sent") { await cloud.sentContents().count == 1 }
        #expect(await cloud.sent.first?.to == "42")
        await MainActor.run { vm.stop() }
    }
}

extension FakeCloud {
    fileprivate func setSignedIn() {
        self.signedIn = true
    }

    fileprivate func setReplyDelay(_ nanoseconds: UInt64) {
        self.replyDelay = nanoseconds
    }
}
