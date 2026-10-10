package ai.builderforce.android.cloud

import ai.builderforce.android.SecurePrefs
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Where the app reaches builderforce.ai: the gateway every API and LLM call goes through
 * (the Synapse desktop app's `gateway_base`), overridable in Settings for development.
 */
class CloudConfig(private val prefs: SecurePrefs) {
  private val _baseUrlOverride = MutableStateFlow(prefs.getString(OVERRIDE_KEY)?.trim().orEmpty())

  /** The developer override, or "" for production. */
  val baseUrlOverride: StateFlow<String> = _baseUrlOverride.asStateFlow()

  /** The gateway base URL in use, without a trailing slash. */
  fun baseUrl(): String = normalize(_baseUrlOverride.value.ifBlank { DEFAULT_BASE_URL })

  /** The web app's origin, for links a person opens. */
  fun webBase(): String = webBaseOf(baseUrl())

  fun setBaseUrlOverride(value: String) {
    val trimmed = normalize(value)
    if (trimmed.isEmpty() || trimmed == DEFAULT_BASE_URL) {
      prefs.remove(OVERRIDE_KEY)
      _baseUrlOverride.value = ""
    } else {
      prefs.putString(OVERRIDE_KEY, trimmed)
      _baseUrlOverride.value = trimmed
    }
  }

  companion object {
    const val DEFAULT_BASE_URL = "https://builderforce.ai/gateway"

    /** How the app names itself to the platform's device flow. */
    const val DEVICE_CLIENT = "android"

    private const val OVERRIDE_KEY = "cloud.baseUrl"

    fun normalize(url: String): String = url.trim().trimEnd('/')

    /** The gateway's host without its path (and without a leading `api.`). */
    fun webBaseOf(gateway: String): String {
      val parts = gateway.split("://", limit = 2)
      val scheme = if (parts.size == 2) parts[0] else "https"
      val rest = if (parts.size == 2) parts[1] else gateway
      val host = rest.substringBefore('/').removePrefix("api.")
      return "$scheme://$host"
    }
  }
}
