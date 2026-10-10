package ai.builderforce.android.cloud

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/**
 * A file stored for a message (`POST /api/brain/upload` answers `{key, name, type}`) — the
 * same record the iOS and macOS apps keep in a turn's `metadata.attachments`.
 */
data class BrainAttachment(val key: String, val name: String, val type: String) {
  val isImage: Boolean get() = type.startsWith("image/")
}

/**
 * The metadata text a person's turn carries: the agent it is addressed to (the platform
 * dispatches that agent) and its attachments, in one object. Null when there is neither.
 */
fun turnMetadata(to: Recipient?, attachments: List<BrainAttachment>): String? {
  if (to == null && attachments.isEmpty()) return null
  val value =
    buildJsonObject {
      if (to != null) {
        put(
          "addressedTo",
          buildJsonObject {
            put("kind", JsonPrimitive("agent"))
            put("ref", JsonPrimitive(to.ref))
            put("name", JsonPrimitive(to.name))
          },
        )
      }
      if (attachments.isNotEmpty()) {
        put("attachments", JsonArray(attachments.map(::attachmentJson)))
      }
    }
  return value.toString()
}

private fun attachmentJson(attachment: BrainAttachment): JsonObject =
  buildJsonObject {
    put("key", JsonPrimitive(attachment.key))
    put("name", JsonPrimitive(attachment.name))
    put("type", JsonPrimitive(attachment.type))
  }

/** One stored attachment (the upload's answer, or an entry of `metadata.attachments`). */
internal fun parseAttachment(el: JsonElement?): BrainAttachment? {
  val o = el.objOrNull() ?: return null
  val key = o["key"].textOrNull()?.takeIf { it.isNotBlank() } ?: return null
  return BrainAttachment(
    key = key,
    name = o["name"].textOrNull()?.takeIf { it.isNotBlank() } ?: key.substringAfterLast('/'),
    type = o["type"].textOrNull().orEmpty(),
  )
}

/** A turn's attachments from its parsed metadata; none when it has no list. */
internal fun parseAttachments(metadata: JsonObject?): List<BrainAttachment> =
  metadata?.get("attachments").arrOrEmpty().mapNotNull(::parseAttachment)
