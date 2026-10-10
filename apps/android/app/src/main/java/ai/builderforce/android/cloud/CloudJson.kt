package ai.builderforce.android.cloud

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** The one JSON reader for the cloud client: tolerant of fields the platform adds. */
internal val cloudJson: Json = Json { ignoreUnknownKeys = true }

/** Parse a response body; a blank body is null, a non-JSON body is kept as a string. */
internal fun parseCloudBody(text: String): JsonElement {
  if (text.isBlank()) return JsonNull
  return try {
    cloudJson.parseToJsonElement(text)
  } catch (_: IllegalArgumentException) {
    JsonPrimitive(text)
  }
}

internal fun JsonElement?.objOrNull(): JsonObject? = this as? JsonObject

internal fun JsonElement?.arrOrEmpty(): List<JsonElement> = (this as? JsonArray) ?: emptyList()

/** A string, or a number spelled as one (ids arrive as either). */
internal fun JsonElement?.textOrNull(): String? =
  when (this) {
    null, is JsonNull -> null
    is JsonPrimitive -> content
    else -> null
  }

internal fun JsonElement?.longOrNull(): Long? = textOrNull()?.trim()?.toLongOrNull()

internal fun JsonElement?.boolOrNull(): Boolean? = textOrNull()?.trim()?.toBooleanStrictOrNull()
