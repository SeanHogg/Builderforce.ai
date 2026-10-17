package ai.builderforce.android.cloud

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BrainMessagePollTest {
  private fun msg(seq: Long, content: String = "m$seq") =
    BrainMessage(
      id = seq.toString(),
      role = "user",
      content = content,
      authorName = null,
      addressedTo = emptyList(),
      createdAtMs = null,
      seq = seq,
    )

  @Test
  fun nothingHeldReadsTheTail() {
    assertNull(pollCursor(emptyList()))
  }

  @Test
  fun aShortTranscriptIsReReadWhole() {
    assertEquals(9L, pollCursor(listOf(msg(10), msg(11), msg(12))))
  }

  @Test
  fun theCursorOverlapsTheNewestFewTurns() {
    val held = (1L..20L).map { msg(it) }
    // Reads after seq 14 → re-reads 15..20, catching a turn that committed late.
    assertEquals(14L, pollCursor(held))
  }

  @Test
  fun repeatsAreReplacedAndNewTurnsJoinInSeqOrder() {
    val held = listOf(msg(1), msg(2), msg(3))
    val merged = mergeMessages(held, listOf(msg(3, "edited"), msg(5), msg(4)))
    assertEquals(listOf(1L, 2L, 3L, 4L, 5L), merged.map { it.seq })
    assertEquals("edited", merged[2].content)
  }

  @Test
  fun anEmptyPollChangesNothing() {
    val held = listOf(msg(1))
    assertEquals(held, mergeMessages(held, emptyList()))
  }
}
