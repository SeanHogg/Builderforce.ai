package ai.builderforce.android.ui.chat

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat

/**
 * Dictation into the composer through Android's SpeechRecognizer — the phone's take on the
 * shared `useVoiceDictation` every other Builderforce composer uses. Each recognised phrase
 * is handed to `onPhrase`, which appends it to the text as it stands.
 */
@Stable
class Dictation internal constructor(val available: Boolean) {
  var listening by mutableStateOf(false)
    internal set

  internal var begin: () -> Unit = {}
  internal var end: () -> Unit = {}

  fun toggle() {
    if (listening) stop() else begin()
  }

  fun stop() {
    if (listening) end()
  }
}

@Composable
fun rememberDictation(onPhrase: (String) -> Unit, onDenied: () -> Unit): Dictation {
  val context = LocalContext.current
  val available = remember(context) { SpeechRecognizer.isRecognitionAvailable(context) }
  val dictation = remember(available) { Dictation(available) }
  val latestOnPhrase by rememberUpdatedState(onPhrase)
  val latestOnDenied by rememberUpdatedState(onDenied)
  val recognizer = remember(context, available) { if (available) SpeechRecognizer.createSpeechRecognizer(context) else null }

  DisposableEffect(recognizer) {
    recognizer?.setRecognitionListener(
      object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {}

        override fun onBeginningOfSpeech() {}

        override fun onRmsChanged(rmsdB: Float) {}

        override fun onBufferReceived(buffer: ByteArray?) {}

        override fun onEndOfSpeech() {}

        override fun onError(error: Int) {
          dictation.listening = false
        }

        override fun onResults(results: Bundle?) {
          val phrase = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.trim().orEmpty()
          dictation.listening = false
          if (phrase.isNotEmpty()) latestOnPhrase(phrase)
        }

        override fun onPartialResults(partialResults: Bundle?) {}

        override fun onEvent(eventType: Int, params: Bundle?) {}
      },
    )
    onDispose { recognizer?.destroy() }
  }

  fun listen() {
    val r = recognizer ?: return
    r.startListening(
      Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
      },
    )
    dictation.listening = true
  }

  val permission =
    rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
      if (granted) listen() else latestOnDenied()
    }

  SideEffect {
    dictation.begin = {
      if (hasMic(context)) listen() else permission.launch(Manifest.permission.RECORD_AUDIO)
    }
    dictation.end = {
      recognizer?.stopListening()
      dictation.listening = false
    }
  }
  return dictation
}

private fun hasMic(context: Context): Boolean =
  ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
