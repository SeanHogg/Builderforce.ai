import BuilderforceKit
import SwiftUI

/// The chat's header: which chat is open (a picker over the workspace's chats), a New
/// chat button, and the account menu. The composer carries none of this.
@MainActor
struct ChatHeader: View {
    @Bindable var viewModel: BuilderforceChatViewModel

    var body: some View {
        HStack(spacing: 8) {
            self.chatPicker
            Spacer(minLength: 0)
            Button {
                self.viewModel.newChat()
            } label: {
                Image(systemName: "square.and.pencil")
                    .font(.body.weight(.medium))
                    .frame(minWidth: 32, minHeight: 32)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(ChatStrings.newChat)
            .accessibilityLabel(ChatStrings.newChat)

            Menu {
                Button(ChatStrings.refresh) {
                    self.viewModel.refresh()
                }
                Button(ChatStrings.signOut, role: .destructive) {
                    self.viewModel.signOut()
                }
            } label: {
                Image(systemName: "ellipsis.circle")
                    .font(.body.weight(.medium))
                    .frame(minWidth: 32, minHeight: 32)
                    .contentShape(Rectangle())
            }
            #if os(macOS)
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            #endif
            .accessibilityLabel(ChatStrings.chats)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
    }

    private var chatPicker: some View {
        Menu {
            ForEach(self.viewModel.chats) { chat in
                Button {
                    self.viewModel.selectChat(chat.id)
                } label: {
                    if chat.id == self.viewModel.activeChatID {
                        Label(Self.title(of: chat), systemImage: "checkmark")
                    } else {
                        Text(Self.title(of: chat))
                    }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text(self.viewModel.activeChat.map { Self.title(of: $0) } ?? ChatStrings.chats)
                    .font(.headline)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Image(systemName: "chevron.down")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
            .foregroundStyle(.primary)
        }
        #if os(macOS)
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
        #endif
        .disabled(self.viewModel.chats.isEmpty)
        .accessibilityLabel(ChatStrings.chats)
    }

    nonisolated static func title(of chat: BrainChat) -> String {
        let title = chat.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return title.isEmpty ? ChatStrings.untitledChat : title
    }
}
