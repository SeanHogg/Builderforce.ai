import BuilderforceKit
import SwiftUI

/// The chat with the Builderforce cloud Brain: sign in when signed out; otherwise the
/// header (chat picker, New chat), the transcript with the reply streaming in, starter
/// suggestions above an empty chat, a tool approval when the Brain asks for one, and the
/// one-box composer. The same view on iOS and macOS.
@MainActor
public struct BuilderforceChatView: View {
    public enum Style {
        case standard
        case onboarding
    }

    @State private var viewModel: BuilderforceChatViewModel
    @State private var scrollerBottomID = UUID()
    @State private var scrollPosition: UUID?
    @State private var hasPerformedInitialScroll = false
    @State private var isPinnedToBottom = true
    private let style: Style
    private let markdownVariant: ChatMarkdownVariant
    private let userAccent: Color?

    private enum Layout {
        #if os(macOS)
        static let messageSpacing: CGFloat = 6
        static let messageListPaddingTop: CGFloat = 12
        static let messageListPaddingBottom: CGFloat = 16
        static let messageListPaddingHorizontal: CGFloat = 12
        #else
        static let messageSpacing: CGFloat = 12
        static let messageListPaddingTop: CGFloat = 10
        static let messageListPaddingBottom: CGFloat = 8
        static let messageListPaddingHorizontal: CGFloat = 12
        #endif
    }

    public init(
        viewModel: BuilderforceChatViewModel,
        style: Style = .standard,
        markdownVariant: ChatMarkdownVariant = .standard,
        userAccent: Color? = nil)
    {
        self._viewModel = State(initialValue: viewModel)
        self.style = style
        self.markdownVariant = markdownVariant
        self.userAccent = userAccent
    }

    public var body: some View {
        ZStack {
            if self.style == .standard {
                BuilderforceChatTheme.background
                    .ignoresSafeArea()
            }

            switch self.viewModel.authState {
            case .signedIn:
                self.chatBody
            case .unknown:
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            case .signedOut, .signingIn:
                ChatSignInView(viewModel: self.viewModel)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .onAppear { self.viewModel.load() }
    }

    private var chatBody: some View {
        VStack(spacing: 0) {
            if self.style == .standard {
                ChatHeader(viewModel: self.viewModel)
                Divider()
            }

            self.messageList

            if let approval = self.viewModel.pendingApproval {
                ChatApprovalCard(
                    approval: approval,
                    decide: { self.viewModel.decideApproval($0) })
                    .padding(.horizontal, 10)
                    .padding(.bottom, 8)
            }

            if self.viewModel.isEmptyChat, !self.viewModel.isLoading {
                ChatSuggestionRow(suggestions: ChatStrings.suggestions) { suggestion in
                    self.viewModel.sendSuggestion(suggestion)
                }
                .padding(.bottom, 8)
            }

            BuilderforceChatComposer(viewModel: self.viewModel, style: self.style)
        }
    }

    private var messageList: some View {
        ZStack {
            ScrollView {
                LazyVStack(spacing: Layout.messageSpacing) {
                    self.messageListRows

                    Color.clear
                        .frame(height: Layout.messageListPaddingBottom)
                        .id(self.scrollerBottomID)
                }
                .scrollTargetLayout()
                .padding(.top, Layout.messageListPaddingTop)
                .padding(.horizontal, Layout.messageListPaddingHorizontal)
            }
            .scrollPosition(id: self.$scrollPosition, anchor: .bottom)
            .onChange(of: self.scrollPosition) { _, position in
                guard let position else { return }
                self.isPinnedToBottom = position == self.scrollerBottomID
            }

            if self.viewModel.isLoading, self.viewModel.messages.isEmpty {
                ProgressView()
                    .controlSize(.large)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if self.viewModel.isEmptyChat {
                self.emptyState
            }
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .layoutPriority(1)
        .onChange(of: self.viewModel.isLoading) { _, isLoading in
            guard !isLoading, !self.hasPerformedInitialScroll else { return }
            self.scrollToBottom(animated: false)
            self.hasPerformedInitialScroll = true
        }
        .onChange(of: self.viewModel.activeChatID) { _, _ in
            self.hasPerformedInitialScroll = false
            self.isPinnedToBottom = true
        }
        .onChange(of: self.viewModel.messages.count) { _, _ in
            if self.viewModel.messages.last?.role.lowercased() == "user" {
                self.isPinnedToBottom = true
            }
            self.followBottom()
        }
        .onChange(of: self.viewModel.isRunning) { _, _ in self.followBottom() }
        .onChange(of: self.viewModel.streamingAssistantText) { _, _ in self.followBottom() }
    }

    @ViewBuilder
    private var messageListRows: some View {
        ForEach(self.viewModel.messages) { msg in
            ChatMessageBubble(
                message: msg,
                style: self.style,
                markdownVariant: self.markdownVariant,
                userAccent: self.userAccent)
                .frame(maxWidth: .infinity, alignment: msg.role.lowercased() == "user" ? .trailing : .leading)
        }

        if !self.viewModel.pendingToolCalls.isEmpty {
            ChatPendingToolsBubble(toolCalls: self.viewModel.pendingToolCalls)
                .equatable()
                .frame(maxWidth: .infinity, alignment: .leading)
        }

        if let text = self.viewModel.streamingAssistantText, AssistantTextParser.hasVisibleContent(in: text) {
            ChatStreamingAssistantBubble(text: text, markdownVariant: self.markdownVariant)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else if self.viewModel.isRunning, self.viewModel.pendingToolCalls.isEmpty {
            HStack {
                ChatTypingIndicatorBubble(style: self.style)
                    .equatable()
                Spacer(minLength: 0)
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "bubble.left.and.bubble.right.fill")
                .font(.title)
                .foregroundStyle(Color.accentColor)
                .accessibilityHidden(true)
            Text(ChatStrings.emptyTitle)
                .font(.headline)
            Text(ChatStrings.emptyMessage)
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 360)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .allowsHitTesting(false)
    }

    private func followBottom() {
        guard self.hasPerformedInitialScroll, self.isPinnedToBottom else { return }
        self.scrollToBottom(animated: true)
    }

    private func scrollToBottom(animated: Bool) {
        if animated {
            withAnimation(.snappy(duration: 0.22)) {
                self.scrollPosition = self.scrollerBottomID
            }
        } else {
            self.scrollPosition = self.scrollerBottomID
        }
        self.isPinnedToBottom = true
    }
}

/// The Brain asks before running a tool that changes something.
private struct ChatApprovalCard: View {
    let approval: BrainToolApproval
    let decide: (Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(ChatStrings.approvalTitle(self.approval.label), systemImage: "hand.raised.fill")
                .font(.subheadline.weight(.semibold))
            if !self.approval.arguments.isEmpty {
                Text(self.approval.arguments)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(4)
                    .textSelection(.enabled)
            }
            HStack(spacing: 8) {
                Spacer(minLength: 0)
                Button(ChatStrings.decline, role: .cancel) {
                    self.decide(false)
                }
                .buttonStyle(.bordered)
                Button(ChatStrings.approve) {
                    self.decide(true)
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(BuilderforceChatTheme.composerFill))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(Color.accentColor.opacity(0.5), lineWidth: 1))
    }
}
