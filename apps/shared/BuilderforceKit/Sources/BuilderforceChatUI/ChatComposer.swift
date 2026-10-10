import BuilderforceKit
import Foundation
import Observation
import SwiftUI
import UniformTypeIdentifiers

#if !os(macOS)
import PhotosUI
#endif

/// The one-box composer every Builderforce surface uses: one filled rounded box holding
/// the attachment chips, the text, and one row under it — `+` on the left, "To …" when
/// the chat has assigned agents, and one round trailing button that is the mic, Send or
/// Stop depending on what the box holds and whether a reply is running.
@MainActor
struct BuilderforceChatComposer: View {
    @Bindable var viewModel: BuilderforceChatViewModel
    let style: BuilderforceChatView.Style

    @State private var dictation = ChatDictation()
    @State private var dictationPrefix = ""
    @ScaledMetric(relativeTo: .body) private var trailingSize: CGFloat = 36
    @ScaledMetric(relativeTo: .body) private var plusSize: CGFloat = 32

    #if os(macOS)
    @State private var shouldFocusTextView = false
    @State private var isFocused = false
    #else
    @State private var pickerItems: [PhotosPickerItem] = []
    @FocusState private var isFocused: Bool
    #endif

    private enum Trailing {
        case send
        case stop
        case dictate
        case stopDictation
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !self.viewModel.queued.isEmpty {
                self.queuedStrip
            }

            VStack(alignment: .leading, spacing: 8) {
                if !self.viewModel.attachments.isEmpty {
                    self.attachmentsStrip
                }
                self.editor
                self.controlRow
            }
            .padding(.horizontal, 12)
            .padding(.top, 10)
            .padding(.bottom, 8)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(BuilderforceChatTheme.composerFill))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(Color.accentColor, lineWidth: 2)
                    .opacity(self.showsRing ? 1 : 0))
            .animation(.easeOut(duration: 0.15), value: self.showsRing)

            if let error = self.errorText {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 6)
            }
        }
        .padding(.horizontal, self.style == .onboarding ? 4 : 8)
        .padding(.bottom, 6)
        #if os(macOS)
            .onDrop(of: [.fileURL], isTargeted: nil) { providers in
                self.handleDrop(providers)
            }
            .onAppear {
                self.shouldFocusTextView = true
            }
        #endif
            .onDisappear {
                self.dictation.stop()
            }
    }

    // MARK: - Box

    private var editor: some View {
        #if os(macOS)
        ZStack(alignment: .topLeading) {
            if self.viewModel.input.isEmpty {
                Text(ChatStrings.placeholder)
                    .foregroundStyle(.tertiary)
                    .padding(.vertical, 4)
                    .allowsHitTesting(false)
            }
            ChatComposerTextView(
                text: self.$viewModel.input,
                shouldFocus: self.$shouldFocusTextView,
                isFocused: self.$isFocused)
            {
                self.viewModel.send()
            }
            .frame(minHeight: 24, idealHeight: 24, maxHeight: self.style == .onboarding ? 64 : 120)
        }
        .accessibilityLabel(ChatStrings.placeholder)
        #else
        TextField(ChatStrings.placeholder, text: self.$viewModel.input, axis: .vertical)
            .font(.body)
            .lineLimit(1...6)
            .focused(self.$isFocused)
        #endif
    }

    private var controlRow: some View {
        HStack(spacing: 8) {
            self.attachButton
            if !self.viewModel.agents.isEmpty {
                self.recipientMenu
            }
            Spacer(minLength: 0)
            self.trailingButton
        }
    }

    private var attachButton: some View {
        #if os(macOS)
        Button {
            self.pickFilesMac()
        } label: {
            self.plusLabel
        }
        .buttonStyle(.plain)
        .help(ChatStrings.addAttachment)
        .accessibilityLabel(ChatStrings.addAttachment)
        #else
        PhotosPicker(selection: self.$pickerItems, maxSelectionCount: 8, matching: .images) {
            self.plusLabel
        }
        .accessibilityLabel(ChatStrings.addAttachment)
        .onChange(of: self.pickerItems) { _, newItems in
            Task { await self.loadPhotosPickerItems(newItems) }
        }
        #endif
    }

    private var plusLabel: some View {
        Image(systemName: "plus")
            .font(.body.weight(.semibold))
            .foregroundStyle(.secondary)
            .frame(width: self.plusSize, height: self.plusSize)
            .contentShape(Circle())
    }

    private var recipientMenu: some View {
        Menu {
            Button(ChatStrings.brain) {
                self.viewModel.recipient = nil
            }
            ForEach(self.viewModel.agents) { agent in
                Button(agent.name) {
                    self.viewModel.recipient = agent
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text(ChatStrings.to(self.viewModel.recipient?.name ?? ChatStrings.brain))
                    .lineLimit(1)
                    .truncationMode(.tail)
                Image(systemName: "chevron.down")
                    .font(.caption2.weight(.semibold))
            }
            .font(.subheadline)
            .foregroundStyle(.primary)
        }
        #if os(macOS)
        .menuStyle(.borderlessButton)
        .fixedSize()
        #endif
        .frame(maxWidth: 200, alignment: .leading)
    }

    private var trailingButton: some View {
        let trailing = self.trailing
        return Button {
            self.perform(trailing)
        } label: {
            Image(systemName: Self.symbol(for: trailing))
                .font(.body.weight(.semibold))
                .foregroundStyle(self.isTrailingEnabled ? Color.white : Color.secondary)
                .frame(width: self.trailingSize, height: self.trailingSize)
                .background(Circle().fill(self.isTrailingEnabled ? Color.accentColor : Color.secondary.opacity(0.25)))
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .disabled(!self.isTrailingEnabled)
        .help(Self.label(for: trailing))
        .accessibilityLabel(Self.label(for: trailing))
    }

    // MARK: - Strips

    private var attachmentsStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(self.viewModel.attachments, id: \BuilderforcePendingAttachment.id) { att in
                    HStack(spacing: 6) {
                        if let img = att.preview {
                            BuilderforcePlatformImageFactory.image(img)
                                .resizable()
                                .scaledToFill()
                                .frame(width: 22, height: 22)
                                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                        } else {
                            Image(systemName: "doc")
                        }
                        Text(att.fileName)
                            .font(.caption)
                            .lineLimit(1)
                        Button {
                            self.viewModel.removeAttachment(att.id)
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(.secondary)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(ChatStrings.removeAttachment)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 5)
                    .background(Capsule().fill(Color.accentColor.opacity(0.12)))
                }
            }
        }
    }

    private var queuedStrip: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(ChatStrings.queuedHint)
                .font(.caption)
                .foregroundStyle(.secondary)
            ForEach(Array(self.viewModel.queued.enumerated()), id: \.offset) { index, text in
                HStack(spacing: 6) {
                    Text(text)
                        .font(.callout)
                        .lineLimit(2)
                    Spacer(minLength: 0)
                    Button {
                        self.viewModel.removeQueued(at: index)
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(ChatStrings.removeQueued)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(BuilderforceChatTheme.composerFill))
            }
        }
        .padding(.horizontal, 4)
    }

    // MARK: - State

    private var hasContent: Bool {
        !self.viewModel.input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !self.viewModel.attachments.isEmpty
    }

    private var showsRing: Bool {
        self.isFocused || self.hasContent
    }

    private var errorText: String? {
        self.dictation.errorText ?? self.viewModel.errorText
    }

    private var trailing: Trailing {
        if self.dictation.isListening { return .stopDictation }
        if self.hasContent { return .send }
        if self.viewModel.isRunning { return .stop }
        if self.dictation.isAvailable { return .dictate }
        return .send
    }

    private var isTrailingEnabled: Bool {
        switch self.trailing {
        case .send:
            self.viewModel.canSend
        case .stop, .stopDictation:
            true
        case .dictate:
            self.viewModel.signedIn
        }
    }

    private func perform(_ trailing: Trailing) {
        switch trailing {
        case .send:
            self.dictation.stop()
            self.viewModel.send()
        case .stop:
            self.viewModel.stop()
        case .stopDictation:
            self.dictation.stop()
        case .dictate:
            let current = self.viewModel.input.trimmingCharacters(in: .whitespacesAndNewlines)
            self.dictationPrefix = current.isEmpty ? "" : current + " "
            let viewModel = self.viewModel
            let prefix = self.dictationPrefix
            self.dictation.start { recognized in
                viewModel.input = prefix + recognized
            }
        }
    }

    private static func symbol(for trailing: Trailing) -> String {
        switch trailing {
        case .send: "arrow.up"
        case .stop: "stop.fill"
        case .dictate: "mic.fill"
        case .stopDictation: "waveform"
        }
    }

    private static func label(for trailing: Trailing) -> String {
        switch trailing {
        case .send: ChatStrings.send
        case .stop: ChatStrings.stop
        case .dictate: ChatStrings.dictate
        case .stopDictation: ChatStrings.stopDictation
        }
    }

    // MARK: - Attachments

    #if os(macOS)
    private func pickFilesMac() {
        let panel = NSOpenPanel()
        panel.title = ChatStrings.chooseImages
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.allowedContentTypes = [.image, .pdf, .plainText]
        let viewModel = self.viewModel
        panel.begin { response in
            guard response == .OK else { return }
            viewModel.addAttachments(urls: panel.urls)
        }
    }

    private func handleDrop(_ providers: [NSItemProvider]) -> Bool {
        let fileProviders = providers.filter { $0.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) }
        guard !fileProviders.isEmpty else { return false }
        let viewModel = self.viewModel
        let deliver: @Sendable (URL) -> Void = { url in
            Task { @MainActor in
                viewModel.addAttachments(urls: [url])
            }
        }
        for provider in fileProviders {
            Self.loadFileURL(from: provider, then: deliver)
        }
        return true
    }

    /// Nonisolated so the provider's completion (called off the main thread) is not
    /// formed as MainActor code.
    private nonisolated static func loadFileURL(from provider: NSItemProvider, then deliver: @escaping @Sendable (URL) -> Void) {
        provider.loadItem(forTypeIdentifier: UTType.fileURL.identifier, options: nil) { item, _ in
            guard let data = item as? Data,
                  let url = URL(dataRepresentation: data, relativeTo: nil)
            else { return }
            deliver(url)
        }
    }
    #else
    private func loadPhotosPickerItems(_ items: [PhotosPickerItem]) async {
        guard !items.isEmpty else { return }
        for item in items {
            do {
                guard let data = try await item.loadTransferable(type: Data.self) else { continue }
                let type = item.supportedContentTypes.first ?? .image
                let ext = type.preferredFilenameExtension ?? "jpg"
                let mime = type.preferredMIMEType ?? "image/jpeg"
                let name = "photo-\(UUID().uuidString.prefix(8)).\(ext)"
                self.viewModel.addImageAttachment(data: data, fileName: name, mimeType: mime)
            } catch {
                self.viewModel.errorText = error.localizedDescription
            }
        }
        self.pickerItems = []
    }
    #endif
}

/// Three short starters above an empty chat, in one horizontally scrolling row.
@MainActor
struct ChatSuggestionRow: View {
    let suggestions: [String]
    let onSelect: (String) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(self.suggestions, id: \.self) { suggestion in
                    Button {
                        self.onSelect(suggestion)
                    } label: {
                        Text(suggestion)
                            .font(.subheadline)
                            .lineLimit(1)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(Capsule().fill(BuilderforceChatTheme.composerFill))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 10)
        }
    }
}

#if os(macOS)
import AppKit

private struct ChatComposerTextView: NSViewRepresentable {
    @Binding var text: String
    @Binding var shouldFocus: Bool
    @Binding var isFocused: Bool
    var onSend: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSScrollView {
        let textView = ChatComposerNSTextView()
        textView.delegate = context.coordinator
        textView.drawsBackground = false
        textView.isRichText = false
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticSpellingCorrectionEnabled = false
        textView.font = .preferredFont(forTextStyle: .body)
        textView.textColor = .labelColor
        textView.insertionPointColor = .controlAccentColor
        textView.textContainer?.lineBreakMode = .byWordWrapping
        textView.textContainer?.lineFragmentPadding = 0
        textView.textContainerInset = NSSize(width: 0, height: 4)
        textView.focusRingType = .none

        textView.minSize = .zero
        textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        textView.isHorizontallyResizable = false
        textView.isVerticallyResizable = true
        textView.autoresizingMask = [.width]
        textView.textContainer?.containerSize = NSSize(width: 0, height: CGFloat.greatestFiniteMagnitude)
        textView.textContainer?.widthTracksTextView = true

        textView.string = self.text
        textView.onSend = { [weak textView] in
            textView?.window?.makeFirstResponder(nil)
            self.onSend()
        }
        textView.onFocusChange = { focused in
            self.isFocused = focused
        }

        let scroll = NSScrollView()
        scroll.drawsBackground = false
        scroll.borderType = .noBorder
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.scrollerStyle = .overlay
        scroll.hasHorizontalScroller = false
        scroll.documentView = textView
        return scroll
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let textView = scrollView.documentView as? ChatComposerNSTextView else { return }

        if self.shouldFocus, let window = scrollView.window {
            window.makeFirstResponder(textView)
            self.shouldFocus = false
        }

        // Typing writes the binding as it happens, so a difference here is text set from
        // outside (send clears the box; dictation fills it).
        if textView.string != self.text {
            context.coordinator.isProgrammaticUpdate = true
            defer { context.coordinator.isProgrammaticUpdate = false }
            textView.string = self.text
        }
    }

    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: ChatComposerTextView
        var isProgrammaticUpdate = false

        init(_ parent: ChatComposerTextView) { self.parent = parent }

        func textDidChange(_ notification: Notification) {
            guard !self.isProgrammaticUpdate else { return }
            guard let view = notification.object as? NSTextView else { return }
            guard view.window?.firstResponder === view else { return }
            self.parent.text = view.string
        }
    }
}

private final class ChatComposerNSTextView: NSTextView {
    var onSend: (() -> Void)?
    var onFocusChange: ((Bool) -> Void)?

    override func becomeFirstResponder() -> Bool {
        let accepted = super.becomeFirstResponder()
        if accepted {
            self.reportFocus(true)
        }
        return accepted
    }

    override func resignFirstResponder() -> Bool {
        let resigned = super.resignFirstResponder()
        if resigned {
            self.reportFocus(false)
        }
        return resigned
    }

    /// Reported on the next turn: focus changes during a SwiftUI update must not write state.
    private func reportFocus(_ focused: Bool) {
        Task { @MainActor [weak self] in
            self?.onFocusChange?(focused)
        }
    }

    override func keyDown(with event: NSEvent) {
        let isReturn = event.keyCode == 36 || event.keyCode == 76
        if isReturn {
            if event.modifierFlags.contains(.shift) {
                super.insertNewline(nil)
                return
            }
            self.onSend?()
            return
        }
        super.keyDown(with: event)
    }
}
#endif
