import AVFoundation
import Foundation
import Observation
import Speech

/// The composer's mic: on-device-preferred speech recognition whose text is appended to
/// the box. Permissions are asked the first time; while listening the button shows Stop.
@MainActor
@Observable
final class ChatDictation {
    private(set) var isListening = false
    private(set) var errorText: String?

    @ObservationIgnored private var capture: SpeechCapture?
    @ObservationIgnored private var session = UUID()

    /// Whether this device can recognise speech in the current language.
    var isAvailable: Bool {
        SFSpeechRecognizer(locale: Locale.current)?.isAvailable ?? false
    }

    /// Start listening; each recognised update is the text to show after `prefix`.
    func start(onText: @escaping @MainActor @Sendable (String) -> Void) {
        guard !self.isListening else { return }
        self.errorText = nil
        let session = UUID()
        self.session = session
        self.isListening = true
        Task {
            guard await SpeechCapture.requestPermissions() else {
                self.finish(session: session, error: ChatStrings.dictationDenied)
                return
            }
            guard self.session == session, self.isListening else { return }
            do {
                let capture = SpeechCapture()
                self.capture = capture
                try capture.start { [weak self] text, isFinal in
                    Task { @MainActor in
                        guard let self, self.session == session else { return }
                        onText(text)
                        if isFinal {
                            self.stop()
                        }
                    }
                }
            } catch {
                self.finish(session: session, error: ChatStrings.dictationUnavailable)
            }
        }
    }

    func stop() {
        self.session = UUID()
        self.capture?.stop()
        self.capture = nil
        self.isListening = false
    }

    private func finish(session: UUID, error: String) {
        guard self.session == session else { return }
        self.stop()
        self.errorText = error
    }
}

/// The audio engine and recognition task. Nonisolated on purpose: its callbacks run on
/// audio and Speech queues, so they are formed here rather than in MainActor code.
private final class SpeechCapture {
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    enum CaptureError: Error {
        case unavailable
    }

    static func requestPermissions() async -> Bool {
        let speech = await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status == .authorized)
            }
        }
        guard speech else { return false }
        #if os(iOS)
        return await AVAudioApplication.requestRecordPermission()
        #else
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            return true
        case .notDetermined:
            return await AVCaptureDevice.requestAccess(for: .audio)
        default:
            return false
        }
        #endif
    }

    func start(onResult: @escaping @Sendable (String, Bool) -> Void) throws {
        guard let recognizer = SFSpeechRecognizer(locale: Locale.current), recognizer.isAvailable else {
            throw CaptureError.unavailable
        }
        #if os(iOS)
        let audio = AVAudioSession.sharedInstance()
        try audio.setCategory(.record, mode: .measurement, options: [.duckOthers])
        try audio.setActive(true, options: .notifyOthersOnDeactivation)
        #endif

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition {
            request.requiresOnDeviceRecognition = true
        }
        self.request = request

        let input = self.engine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format, block: Self.tap(feeding: request))
        self.engine.prepare()
        try self.engine.start()

        self.task = recognizer.recognitionTask(with: request) { result, error in
            if let result {
                onResult(result.bestTranscription.formattedString, result.isFinal)
            } else if error != nil {
                onResult("", true)
            }
        }
    }

    func stop() {
        self.engine.inputNode.removeTap(onBus: 0)
        if self.engine.isRunning {
            self.engine.stop()
        }
        self.request?.endAudio()
        self.task?.cancel()
        self.task = nil
        self.request = nil
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        #endif
    }

    private static func tap(feeding request: SFSpeechAudioBufferRecognitionRequest) -> AVAudioNodeTapBlock {
        { buffer, _ in request.append(buffer) }
    }
}
