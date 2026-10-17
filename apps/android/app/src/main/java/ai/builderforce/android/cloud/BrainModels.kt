package ai.builderforce.android.cloud

import java.time.Instant
import java.time.format.DateTimeParseException
import kotlinx.serialization.json.JsonElement

/** One of the workspace's Brain chats — the same conversations the web app lists. */
data class BrainChat(val id: Long, val title: String?, val updatedAt: String?)

/**
 * One turn of a chat. [authorName] is the agent (or person) that wrote an assistant turn
 * on someone else's behalf; [addressedTo] names who a user turn was for; [attachments] are
 * the files stored with it (`metadata.attachments`).
 */
data class BrainMessage(
  val id: String,
  val role: String,
  val content: String,
  val authorName: String?,
  val addressedTo: List<String>,
  val createdAtMs: Long?,
  val attachments: List<BrainAttachment> = emptyList(),
  /** The chat's append order (`seq`); the cursor an incremental poll reads after. */
  val seq: Long? = null,
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
    attachments = parseAttachments(metadata),
    seq = o["seq"].longOrNull(),
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
  messages.filter { (it.role == "user" || it.role == "assistant") && (it.content.isNotBlank() || it.attachments.isNotEmpty()) }

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

/**
 * Where an incremental poll reads from (`?afterSeq=`): a few turns back from the newest
 * held seq, not the newest itself. Appends get their seq from the row id, so two writers
 * can commit slightly out of order; re-reading a short overlap catches a late commit, and
 * [mergeMessages] drops the repeats. Null when nothing with a seq is held — read the tail.
 */
fun pollCursor(held: List<BrainMessage>): Long? {
  val seqs = held.mapNotNull { it.seq }.sorted()
  if (seqs.isEmpty()) return null
  return if (seqs.size > POLL_OVERLAP) seqs[seqs.size - 1 - POLL_OVERLAP] else seqs.first() - 1
}

/**
 * [held] plus what an incremental poll returned: a turn already held is replaced by its
 * newer copy, new turns join in seq order, and only the newest [MAX_HELD_MESSAGES] stay.
 */
fun mergeMessages(held: List<BrainMessage>, fresh: List<BrainMessage>): List<BrainMessage> {
  if (fresh.isEmpty()) return held
  val byId = LinkedHashMap<String, BrainMessage>()
  for (m in held) byId[m.id] = m
  for (m in fresh) byId[m.id] = m
  return byId.values.sortedWith(compareBy(nullsLast()) { it.seq }).takeLast(MAX_HELD_MESSAGES)
}

private const val POLL_OVERLAP = 5
private const val MAX_HELD_MESSAGES = 500
