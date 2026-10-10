package ai.builderforce.android.voice

import android.content.Context
import android.speech.SpeechRecognizer
import ai.builderforce.android.R

/**
 * Localized status line for a [SpeechRecognizer] error, shared by Voice Wake and Talk Mode.
 * "No match" and "speech timeout" just mean nobody spoke, so they read as still listening.
 */
internal fun speechRecognizerErrorText(context: Context, error: Int): String =
  when (error) {
    SpeechRecognizer.ERROR_AUDIO -> context.getString(R.string.voice_error_audio)
    SpeechRecognizer.ERROR_CLIENT -> context.getString(R.string.voice_error_client)
    SpeechRecognizer.ERROR_NETWORK -> context.getString(R.string.voice_error_network)
    SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> context.getString(R.string.voice_error_network_timeout)
    SpeechRecognizer.ERROR_NO_MATCH -> context.getString(R.string.voice_status_listening)
    SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> context.getString(R.string.voice_error_busy)
    SpeechRecognizer.ERROR_SERVER -> context.getString(R.string.voice_error_server)
    SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> context.getString(R.string.voice_status_listening)
    else -> context.getString(R.string.voice_error_other, error)
  }
