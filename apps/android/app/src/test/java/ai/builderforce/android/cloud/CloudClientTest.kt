package ai.builderforce.android.cloud

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class CloudClientTest {
  @Test
  fun webBaseDropsTheGatewayPathAndApiPrefix() {
    assertEquals("https://builderforce.ai", CloudConfig.webBaseOf("https://builderforce.ai/gateway"))
    assertEquals("https://builderforce.ai", CloudConfig.webBaseOf("https://api.builderforce.ai"))
    assertEquals("http://localhost:8787", CloudConfig.webBaseOf("http://localhost:8787/gateway"))
  }

  @Test
  fun streamedTextArrivesPieceByPiece() {
    val acc = TurnAccumulator()
    val shown = StringBuilder()
    for (line in listOf(
      """data: {"choices":[{"delta":{"content":"Hel"}}]}""",
      "",
      """data: {"choices":[{"delta":{"content":"lo"},"finish_reason":"stop"}]}""",
      "data: [DONE]",
    )) {
      acc.line(line)?.let { shown.append(it) }
    }
    val turn = acc.finish()
    assertEquals("Hello", shown.toString())
    assertEquals("Hello", turn.text)
    assertEquals("stop", turn.finishReason)
    assertTrue(acc.done)
    assertTrue(turn.toolCalls.isEmpty())
  }

  @Test
  fun toolCallFragmentsAreStitchedByIndex() {
    val acc = TurnAccumulator()
    acc.line("""data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"builtin_tasks_list","arguments":"{\"pro"}}]}}]}""")
    acc.line("""data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"c2","function":{"name":"builtin_projects_list","arguments":"{}"}}]}}]}""")
    acc.line("""data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"jectId\":7}"}}]}}]}""")
    val turn = acc.finish()
    assertEquals(2, turn.toolCalls.size)
    assertEquals(ToolCall(id = "c1", name = "builtin_tasks_list", arguments = "{\"projectId\":7}"), turn.toolCalls[0])
    assertEquals("builtin_projects_list", turn.toolCalls[1].name)
  }

  @Test
  fun junkIsSkippedAndAnUpstreamErrorFails() {
    val acc = TurnAccumulator()
    assertNull(acc.line("data: {not json"))
    assertNull(acc.line(": keep-alive"))
    try {
      acc.line("""data: {"error":{"message":"overloaded"}}""")
      fail("an upstream error must fail the turn")
    } catch (e: StreamFailedException) {
      assertEquals("overloaded", e.message)
    }
  }

  @Test
  fun theConversationNamesOtherAuthorsAndFindsTheQuestion() {
    val messages =
      listOf(
        message("user", "Plan the launch"),
        message("assistant", "On it", author = "Ada"),
        message("tool", "ignored"),
        message("user", "  What is left?  "),
      )
    val (convo, question) = BrainReplyRunner.conversation(messages)
    assertEquals(3, convo.size)
    assertEquals("[Ada] On it", convo[1]["content"]?.jsonPrimitive?.content)
    assertEquals("What is left?", question)
  }

  @Test
  fun imagesRideOnTheLatestUserTurn() {
    val (convo, _) = BrainReplyRunner.conversation(listOf(message("user", "What is this?")))
    val withImages = BrainReplyRunner.withImages(convo, listOf(ImageAttachment("a.png", "image/png", "AAAA")))
    val parts = withImages[0]["content"] as JsonArray
    assertEquals(2, parts.size)
    assertEquals("data:image/png;base64,AAAA", ((parts[1] as JsonObject)["image_url"] as JsonObject)["url"]?.jsonPrimitive?.content)
  }

  @Test
  fun metadataNamesTheAuthorAndTheRecipients() {
    val el =
      parseCloudBody(
        """{"id":7,"role":"user","content":"hi","createdAt":"2026-10-10T10:00:00Z",""" +
          """"metadata":"{\"addressedTo\":{\"kind\":\"agent\",\"ref\":\"12\",\"name\":\"Ada\"}}"}""",
      )
    val m = parseMessage(el, 0)!!
    assertEquals("7", m.id)
    assertEquals(listOf("Ada"), m.addressedTo)
    assertEquals(1_791_626_400_000L, m.createdAtMs)
  }

  @Test
  fun anAgentIsAwaitedOnlyWhileTheLastTurnIsARecentMessageToIt() {
    val now = 1_000_000_000L
    val toAda = message("user", "Fix it", to = listOf("Ada"), at = now - 1000)
    assertEquals("Ada", awaitingAgent(listOf(toAda), now))
    assertNull(awaitingAgent(listOf(toAda, message("assistant", "Done", author = "Ada")), now))
    assertNull(awaitingAgent(listOf(toAda.copy(createdAtMs = now - 4 * 60_000)), now))
    assertNull(awaitingAgent(listOf(message("user", "Hello Brain")), now))
  }

  @Test
  fun aToolThatDoesNotSayItOnlyReadsCountsAsWriting() {
    val read = PlatformTool("builtin", "tasks.list", "builtin_tasks_list", "List", null, mutates = false)
    val external = PlatformTool("x1", "send", "x1_send", "", null, mutates = null)
    assertTrue(!read.writes)
    assertTrue(external.writes)
    assertEquals("tasks list", toolLabel(read.name))
  }

  private fun message(role: String, content: String, author: String? = null, to: List<String> = emptyList(), at: Long? = null) =
    BrainMessage(id = content, role = role, content = content, authorName = author, addressedTo = to, createdAtMs = at)
}
