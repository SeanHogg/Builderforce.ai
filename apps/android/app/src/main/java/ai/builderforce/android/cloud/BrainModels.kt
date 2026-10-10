package ai.builderforce.android.cloud

import java.time.Instant
import java.time.format.DateTimeParseException
import kotlinx.serialization.json.JsonElement

/** One of the workspace's Brain chats — the same conversations the web app lists. */
data class BrainChat(val id: Long, val title: String?, val updatedAt: String?)

/**
 * One turn of a chat. [authorName] is the agent (or person) that wrote an assistant turn
 * on someone else's behalf; [addressedTo] names who a user turn was for.
 */
data class BrainMessage(
  val id: String,
  val role: String,
  val content: String,
  val authorName: String?,
  val addressedTo: List<String>,
  val createdAtMs: Long?,
)

/** An agent a message can be addressed to (one assigned to the open chat). */
data class Recipient(val ref: String, val name: String)

internal fun parseChat(el: JsonElement): BrainChat? {
  val o = el.objOrNull() ?: return null
  val id = o["id"].longOrNull() ?: return null
  return BrainChat(
    id = id,
    title = o["title"].textOrNull()?.trim()?.takeIf { it.isNotEmpty() },
    updatedAt = o["updatedAt"].textOrNull() ?: o["createdAt"].textOrNull(),
  )
}

internal fun parseMessage(el: JsonElement, index: Int): BrainMessage? {
  val o = el.objOrNull() ?: return null
  val metadata = metadataOf(o["metadata"])
  val addressed = metadata?.get("addressedTo").objOrNull()
  val recipients =
    when {
      addressed == null -> emptyList()
      addressed["kind"].textOrNull() == "group" ->
        addressed["members"].arrOrEmpty().mapNotNull { it.objOrNull()?.get("name").textOrNull() }
      else -> listOfNotNull(addressed["name"].textOrNull())
    }
  return BrainMessage(
    id = o["id"].textOrNull() ?: "m$index",
    role = o["role"].textOrNull().orEmpty(),
    content = o["content"].textOrNull().orEmpty(),
    authorName = metadata?.get("authoredBy").objOrNull()?.get("name").textOrNull(),
    addressedTo = recipients.filter { it.isNotBlank() },
    createdAtMs = o["createdAt"].textOrNull()?.let(::parseInstantMs),
  )
}

/** `metadata` arrives as a JSON string (the stored column) or, from some hosts, an object. */
private fun metadataOf(el: JsonElement?) =
  el.objOrNull() ?: el.textOrNull()?.let { parseCloudBody(it).objOrNull() }

private fun parseInstantMs(raw: String): Long? =
  try {
    Instant.parse(raw).toEpochMilli()
  } catch (_: DateTimeParseException) {
    null
  }

/** The turns a person reads: user and assistant turns with something in them. */
fun visibleMessages(messages: List<BrainMessage>): List<BrainMessage> =
  messages.filter { (it.role == "user" || it.role == "assistant") && it.content.isNotBlank() }

/**
 * Who an agent-addressed message is still waiting on: the last turn is the person's, to an
 * agent, sent in the last three minutes — worth polling fast (Synapse's `awaitingAgent`).
 */
fun awaitingAgent(messages: List<BrainMessage>, nowMs: Long): String? {
  val last = visibleMessages(messages).lastOrNull() ?: return null
  if (last.role != "user" || last.addressedTo.isEmpty()) return null
  val at = last.createdAtMs
  if (at != null && nowMs - at >= AWAIT_AGENT_MS) return null
  return last.addressedTo.joinToString(", ")
}

private const val AWAIT_AGENT_MS = 3 * 60_000L
