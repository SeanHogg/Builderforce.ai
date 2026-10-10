package ai.builderforce.android.voice

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import ai.builderforce.android.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

class VoiceWakeManager(
  private val context: Context,
  private val scope: CoroutineScope,
  private val onCommand: suspend (String) -> Unit,
) {
  private val mainHandler = Handler(Looper.getMainLooper())

  private val _isListening = MutableStateFlow(false)
  val isListening: StateFlow<Boolean> = _isListening

  private val _statusText = MutableStateFlow(context.getString(R.string.voice_status_off))
  val statusText: StateFlow<String> = _statusText

  var triggerWords: List<String> = emptyList()
    private set

  private var recognizer: SpeechRecognizer? = null
  private var restartJob: Job? = null
  private var lastDispatched: String? = null
  private var stopRequested = false

  fun setTriggerWords(words: List<String>) {
    triggerWords = words
  }

  fun start() {
    mainHandler.post {
      if (_isListening.value) return@post
      stopRequested = false

      if (!SpeechRecognizer.isRecognitionAvailable(context)) {
        _isListening.value = false
        _statusText.value = context.getString(R.string.voice_status_recognizer_unavailable)
        return@post
      }

      try {
        recognizer?.destroy()
        recognizer = SpeechRecognizer.createSpeechRecognizer(context).also { it.setRecognitionListener(listener) }
        startListeningInternal()
      } catch (err: Throwable) {
        _isListening.value = false
        _statusText.value = context.getString(R.string.voice_status_start_failed, err.message ?: err::class.simpleName.orEmpty())
      }
    }
  }

  fun stop(statusText: String = context.getString(R.string.voice_status_off)) {
    stopRequested = true
    restartJob?.cancel()
    restartJob = null
    mainHandler.post {
      _isListening.value = false
      _statusText.value = statusText
      recognizer?.cancel()
      recognizer?.destroy()
      recognizer = null
    }
  }

  private fun startListeningInternal() {
    val r = recognizer ?: return
    val intent =
      Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
        putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
      }

    _statusText.value = context.getString(R.string.voice_status_listening)
    _isListening.value = true
    r.startListening(intent)
  }

  private fun scheduleRestart(delayMs: Long = 350) {
    if (stopRequested) return
    restartJob?.cancel()
    restartJob =
      scope.launch {
        delay(delayMs)
        mainHandler.post {
          if (stopRequested) return@post
          try {
            recognizer?.cancel()
            startListeningInternal()
          } catch (_: Throwable) {
            // Will be picked up by onError and retry again.
          }
        }
      }
  }

  private fun handleTranscription(text: String) {
    val command = VoiceWakeCommandExtractor.extractCommand(text, triggerWords) ?: return
    if (command == lastDispatched) return
    lastDispatched = command

    scope.launch { onCommand(command) }
    _statusText.value = context.getString(R.string.voice_status_triggered)
    scheduleRestart(delayMs = 650)
  }

  private val listener =
    object : RecognitionListener {
      override fun onReadyForSpeech(params: Bundle?) {
        _statusText.value = context.getString(R.string.voice_status_listening)
      }

      override fun onBeginningOfSpeech() {}

      override fun onRmsChanged(rmsdB: Float) {}

      override fun onBufferReceived(buffer: ByteArray?) {}

      override fun onEndOfSpeech() {
        scheduleRestart()
      }

      override fun onError(error: Int) {
        if (stopRequested) return
        _isListening.value = false
        if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
          _statusText.value = context.getString(R.string.voice_status_mic_permission)
          return
        }

        _statusText.value = speechRecognizerErrorText(context, error)
        scheduleRestart(delayMs = 600)
      }

      override fun onResults(results: Bundle?) {
        val list = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION).orEmpty()
        list.firstOrNull()?.let(::handleTranscription)
        scheduleRestart()
      }

      override fun onPartialResults(partialResults: Bundle?) {
        val list = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION).orEmpty()
        list.firstOrNull()?.let(::handleTranscription)
      }

      override fun onEvent(eventType: Int, params: Bundle?) {}
    }
}
