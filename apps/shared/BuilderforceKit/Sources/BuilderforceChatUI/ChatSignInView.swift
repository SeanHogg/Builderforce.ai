import BuilderforceKit
import SwiftUI

/// The signed-out chat: sign in to Builderforce with the device flow — the app shows a
/// short code, the person confirms it on the verification page in the browser, and the
/// chat opens once the platform hands the key over. The same view on iOS and macOS.
@MainActor
struct ChatSignInView: View {
    @Bindable var viewModel: BuilderforceChatViewModel
    @Environment(\.openURL) private var openURL

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                Image(systemName: "person.crop.circle.badge.checkmark")
                    .font(.largeTitle)
                    .foregroundStyle(Color.accentColor)
                    .accessibilityHidden(true)

                Text(ChatStrings.signInTitle)
                    .font(.title2.weight(.semibold))
                    .multilineTextAlignment(.center)

                Text(ChatStrings.signInMessage)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)

                self.content

                if let error = self.viewModel.errorText {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: 360)
            .padding(24)
            .frame(maxWidth: .infinity)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch self.viewModel.authState {
        case let .signingIn(code?):
            self.codeCard(code)
        case .signingIn(.none):
            VStack(spacing: 12) {
                ProgressView()
                Text(ChatStrings.signInStarting)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Button(ChatStrings.signInCancel, role: .cancel) {
                    self.viewModel.cancelSignIn()
                }
                .buttonStyle(.borderless)
            }
        default:
            Button {
                self.viewModel.startSignIn()
            } label: {
                Text(ChatStrings.signInButton)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
    }

    private func codeCard(_ code: DeviceCode) -> some View {
        VStack(spacing: 12) {
            Text(ChatStrings.signInCodePrompt)
                .font(.footnote)
                .foregroundStyle(.secondary)
            Text(code.userCode)
                .font(.system(.title, design: .monospaced).weight(.semibold))
                .textSelection(.enabled)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(BuilderforceChatTheme.composerFill))

            if let url = code.openURL {
                Button {
                    self.openURL(url)
                } label: {
                    Label(ChatStrings.signInOpen, systemImage: "safari")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            }

            HStack(spacing: 8) {
                ProgressView()
                    .controlSize(.small)
                Text(ChatStrings.signInWaiting)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Button(ChatStrings.signInCancel, role: .cancel) {
                self.viewModel.cancelSignIn()
            }
            .buttonStyle(.borderless)
        }
    }
}
