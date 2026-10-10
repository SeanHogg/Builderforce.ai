import BuilderforceChatUI
import SwiftUI

/// Chat with the Builderforce cloud Brain (signed in with the device flow). Node features
/// stay on the gateway; only chat lives in the cloud.
struct ChatSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var viewModel: BuilderforceChatViewModel
    private let userAccent: Color?

    init(transport: any BuilderforceChatTransport = BuilderforceCloudChatTransport(), userAccent: Color? = nil) {
        self._viewModel = State(initialValue: BuilderforceChatViewModel(transport: transport))
        self.userAccent = userAccent
    }

    var body: some View {
        NavigationStack {
            BuilderforceChatView(
                viewModel: self.viewModel,
                userAccent: self.userAccent)
                .navigationTitle(ChatStrings.title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            self.dismiss()
                        } label: {
                            Image(systemName: "xmark")
                        }
                        .accessibilityLabel(ChatStrings.close)
                    }
                }
        }
    }
}
