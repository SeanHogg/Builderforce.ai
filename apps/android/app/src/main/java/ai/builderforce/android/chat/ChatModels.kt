package ai.builderforce.android.chat

import ai.builderforce.android.cloud.ImageAttachment
import ai.builderforce.android.cloud.Recipient

/** A message typed while a reply was running: it goes once the reply is done. */
data class QueuedMessage(
  val id: Long,
  val chatId: Long?,
  val text: String,
  val to: Recipient?,
  val images: List<ImageAttachment>,
)

/** A tool that changes something, waiting for the person's Approve or Decline. */
data class ToolApproval(val id: Long, val label: String, val arguments: String)

/** The Brain's reply in [chatId] while it is being written. */
data class LiveReply(
  val chatId: Long,
  val draft: String = "",
  val activity: String? = null,
  val approval: ToolApproval? = null,
)

/**
 * The agent a message opens with `@Name` for, if any — the longest name wins ("@Ann Lee"
 * over "@Ann"), and the name must end at a word boundary.
 */
fun mentionedAgent(text: String, agents: List<Recipient>): Recipient? {
  val lower = text.trimStart().lowercase()
  if (!lower.startsWith("@")) return null
  return agents.sortedByDescending { it.name.length }.firstOrNull { agent ->
    val name = "@${agent.name.lowercase()}"
    lower.startsWith(name) && lower.getOrNull(name.length)?.isLetterOrDigit() != true
  }
}
